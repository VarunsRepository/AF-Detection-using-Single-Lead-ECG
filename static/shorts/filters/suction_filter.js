// ---------------------------------------------------------------------------
// filters/suction_filter.js
//
// What a fan car actually does, in four questions:
//
//   speed   how downforce varies with road speed -- wing against fan
//   seal    how it varies with skirt gap, which is the whole trick
//   claim   what underbody pressure a stated downforce figure demands
//   thrust  why a cold-gas thruster is NOT the same mechanism
//
// THE MODEL
//   A fan pulls air out of a sealed volume; air leaks back in under the
//   skirts. At steady state the two flows balance, and that balance point
//   sets the pressure. Two curves meeting:
//
//     fan      Q = Qmax * (1 - dP/dPmax)        linear fan characteristic
//     leak     Q = Cd * (perimeter * gap) * sqrt(2*dP/rho)     orifice flow
//
//   Equate and solve for dP. There is no closed form, so it is bisected
//   on [0, dPmax] -- the fan curve starts above the leak curve at dP=0
//   and ends below it at dP=dPmax, so exactly one root exists.
//
//   Downforce is then simply dP * sealedArea. Atmospheric pressure does
//   the work; the fan only has to remove the air underneath.
//
// WHY THE SEAL IS EVERYTHING, AND WHY IT IS ASYMMETRIC
//   Leak flow goes as gap and as sqrt(dP), so AT FIXED FLOW the pressure
//   would go as 1/gap^2 -- halve the gap, quadruple the pressure.
//
//   A real fan does not hold flow fixed. As pressure rises it moves less
//   air, and at stall it moves none, so the idealised 1/gap^2 is an
//   upper bound the fan curve never lets you reach. Running the model on
//   the BT46B parameters, doubling the gap from 8mm to 16mm costs a
//   factor of 2.4 and is still climbing toward 4; going the other way,
//   from 2mm to 1mm, buys only 1.15.
//
//   That asymmetry is the whole engineering problem. Tightening the seal
//   has diminishing returns, while LOSING it collapses the downforce
//   fast -- which is why the ground-effect era was lethal when a skirt
//   failed, and why these cars were never a little bit unstable.
//
// WHAT THIS IS NOT
//   A lumped model: one pressure, one leak path, incompressible. No
//   boundary layer, no flow separation, no vortices, no diffuser
//   shaping, no compressibility. It shows WHY the trick works and what
//   governs it. It is not CFD and will not give you a real car's number.
//
// Self-registers into DSP_ALGORITHMS (dsp_registry.js must load first).
// ---------------------------------------------------------------------------

(function () {
"use strict";

const P_ATM = 101325;      // Pa

// Leak flow through the skirt gap, treated as a thin-edged orifice of
// area perimeter x gap.
function leakFlow(dP, cd, perim, gapM, rho) {
    if (dP <= 0 || gapM <= 0) return 0;
    return cd * perim * gapM * Math.sqrt(2 * dP / rho);
}

// Where the fan curve crosses the system curve. Bisection rather than
// anything cleverer: 60 iterations on a bracketed monotonic function is
// exact to float precision and cannot fail to converge.
function operatingPoint(p) {
    const { qMax, dPMax, cd, perim, gapM, rho } = p;
    if (!qMax || !dPMax) return null;
    // A perfect seal means no leak path at all, so the fan simply reaches
    // its stall pressure. Worth special-casing: the bisection would get
    // there too, but only after 60 pointless iterations.
    if (gapM <= 0) return { dP: dPMax, q: 0 };

    const excess = dP => qMax * (1 - dP / dPMax) - leakFlow(dP, cd, perim, gapM, rho);
    let lo = 0, hi = dPMax;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (excess(mid) > 0) lo = mid; else hi = mid;
    }
    const dP = (lo + hi) / 2;
    return { dP, q: qMax * (1 - dP / dPMax) };
}

const wingForce = (v, rho, area, cl) => 0.5 * rho * v * v * area * cl;

registerDspAlgorithm("fan_suction", {
    process(envelope, parameters) {
        const m = envelope?.meta ?? {};
        const rho = m.rho ?? 1.225;
        const g = m.g ?? 9.80665;
        const cd = m.cd ?? 0.6;

        const mass = m.mass_kg;
        const area = m.sealedArea_m2;
        const perim = m.sealPerimeter_m;
        if (!mass || !area || !perim) {
            return { error: "Need mass, sealed area and seal perimeter." };
        }

        const weight = mass * g;
        // The force the atmosphere ALREADY applies to the car's floor,
        // in tonnes. About 31 tonnes on 3 square metres. It normally
        // cancels exactly -- the same pressure pushes up from below --
        // and a fan car works by unbalancing it very slightly. For a
        // reader with no physics this single number explains the whole
        // mechanism better than any amount of talk about pressure.
        const atmForce = P_ATM * area;
        const atmTonnes = atmForce / 9806.65;
        const gapM = (m.skirtGap_mm ?? 5) / 1000;
        const base = { qMax: m.fanQmax_m3s, dPMax: m.fanDPmax_Pa,
                       cd, perim, rho };

        // ── Nominal operating point ─────────────────────────────────────
        const op = operatingPoint({ ...base, gapM });
        const fanForce = op ? op.dP * area : null;
        const fanG = fanForce === null ? null : fanForce / weight;

        // ── speed: a wing needs velocity, a fan does not ────────────────
        const speedSteps = [];
        const V_MAX = 90;                       // m/s, ~324 km/h
        for (let i = 0; i <= 24; i++) {
            const v = V_MAX * i / 24;
            speedSteps.push({
                v, kmh: v * 3.6,
                wing: wingForce(v, rho, m.wingArea_m2 ?? 0, m.wingCl ?? 0),
                fan: fanForce,
            });
        }
        // Where the wing finally overtakes the fan. Below it the fan car
        // has downforce nothing else can supply; above it a wing is the
        // better answer, which is why no one has ever run only a fan.
        let crossV = null;
        if (fanForce) {
            for (let i = 1; i < speedSteps.length; i++) {
                if (speedSteps[i - 1].wing < fanForce && speedSteps[i].wing >= fanForce) {
                    crossV = speedSteps[i].v;
                    break;
                }
            }
        }

        // ── seal: dP against skirt gap ──────────────────────────────────
        const sealSteps = [];
        for (let i = 0; i <= 24; i++) {
            const mm = 0.5 + (20 - 0.5) * i / 24;
            const o = operatingPoint({ ...base, gapM: mm / 1000 });
            sealSteps.push({
                gapMm: mm,
                dP: o ? o.dP : null,
                force: o ? o.dP * area : null,
                g: o ? (o.dP * area) / weight : null,
            });
        }

        // ── claim: run it backwards ─────────────────────────────────────
        // No fan specification is needed to check a downforce claim. The
        // force is dP x area, so a claimed force in g fixes the pressure
        // the underbody must hold. That is arithmetic, and it is the one
        // number a manufacturer cannot route around.
        const claimedG = m.claimedG ?? null;
        const requiredDP = claimedG === null ? null : (claimedG * weight) / area;
        const claimSteps = [];
        if (claimedG !== null || fanForce !== null) {
            const target = requiredDP ?? op.dP;
            for (let i = 0; i <= 20; i++) {
                const dP = target * i / 20;
                claimSteps.push({
                    dP,
                    absolute: P_ATM - dP,
                    pctOfAtm: 100 * dP / P_ATM,
                    force: dP * area,
                    g: (dP * area) / weight,
                });
            }
        }

        // ── thrust: a different equation entirely ───────────────────────
        // Thrust is mass flow times exhaust velocity -- momentum thrown
        // away, not pressure over an area. No seal, no area term, and a
        // tank that empties. The burn time is the whole story.
        const thrust = m.thrust_N ?? null;
        let thrustSteps = [], mdot = null, burnS = null;
        if (thrust && m.exhaustVel_ms && m.gasMass_kg) {
            mdot = thrust / m.exhaustVel_ms;
            burnS = m.gasMass_kg / mdot;
            for (let i = 0; i <= 20; i++) {
                const t = burnS * i / 20;
                thrustSteps.push({
                    t,
                    gasLeft: Math.max(0, m.gasMass_kg - mdot * t),
                    frac: 1 - i / 20,
                    thrust,
                });
            }
        }

        const interimOutputs = [];
        const push = (view, arr, label) => arr.forEach((s, idx) =>
            interimOutputs.push({ view, idx, label: label(s), step: s }));

        push("speed", speedSteps, s => `${s.kmh.toFixed(0)} km/h`);
        push("seal", sealSteps, s => `${s.gapMm.toFixed(1)} mm gap`);
        push("claim", claimSteps, s => `${s.pctOfAtm.toFixed(1)}% below ambient`);
        push("thrust", thrustSteps, s => `${s.t.toFixed(2)} s`);

        return {
            interimOutputs,
            finalOutput: {
                name: m.name ?? "car", year: m.year ?? null,
                note: m.note ?? "", tags: m.tags ?? {},
                mass, area, perim, weight, atmForce, atmTonnes,
                gapMm: m.skirtGap_mm ?? null,
                hasFanSpec: !!op,
                dP: op ? op.dP : null,
                flow: op ? op.q : null,
                fanForce, fanG,
                pctOfAtm: op ? 100 * op.dP / P_ATM : null,
                speedSteps, sealSteps, claimSteps, thrustSteps,
                crossV, crossKmh: crossV === null ? null : crossV * 3.6,
                claimedG, requiredDP,
                requiredPctOfAtm: requiredDP === null ? null : 100 * requiredDP / P_ATM,
                claimedUpsideDown: m.claimedUpsideDown ?? false,
                thrust, mdot, burnS,
                exhaustVel: m.exhaustVel_ms ?? null,
                gasMass: m.gasMass_kg ?? null,
                thrustToWeight: thrust ? thrust / weight : null,
            },
        };
    },
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = { operatingPoint, leakFlow, wingForce, P_ATM };
}

})();