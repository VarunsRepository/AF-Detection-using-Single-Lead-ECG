# ---------------------------------------------------------------------------
# Services/Analytics_Store.py
#
# Stores feed interaction events and answers the questions the
# recommendation engine asks.
#
# WHY SQLITE, NOT JSON:
#   The other stores hold small, wholly-rewritten documents -- a recipe
#   registry is read in full and written in full. Events are different:
#   append-only, unbounded, and only useful when AGGREGATED
#   ("completion rate GROUP BY journey, label"). That is a query
#   workload, not a document workload. JSON would mean loading every
#   event into memory to compute a rate.
#
# WHAT IS DELIBERATELY NOT STORED:
#   No IP address. No user agent. No device fingerprint. No identity.
#   session_id is a random UUID generated per browser tab -- it groups
#   events within one sitting and links to nothing outside it.
#
#   IP was considered and rejected: mobile IPs change per cell handoff,
#   shared clinic WiFi collapses many users into one, and CGNAT does the
#   reverse. It would be unreliable AND personal data under GDPR. An
#   anonymous session token answers the same questions without either
#   problem.
# ---------------------------------------------------------------------------

import os
import sqlite3
from typing import Any
import threading
from datetime import datetime, timezone


class AnalyticsStore:

    # Only these are accepted; anything else is rejected at insert time so
    # a typo in a client call site can't silently create a phantom event
    # type that then pollutes every aggregate.
    VALID_EVENTS = {
        "card_entered", "card_exited",
        "stage_started", "stage_completed",
        "paused", "resumed", "restarted",
        "algorithm_switched", "renderer_switched", "speed_changed",
        "journey_opened", # to accomodate the change wherein we added a button to add curated cards for a journey in a tour
    }

    def __init__(self, cache_dir: str = "data_cache"):
        self.store_dir = os.path.join(cache_dir, "AnalyticsStore")
        self.db_path   = os.path.join(self.store_dir, "analytics.db")
        self._lock     = threading.Lock()
        os.makedirs(self.store_dir, exist_ok=True)
        self._init_schema()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._lock, self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id    TEXT    NOT NULL,
                    event         TEXT    NOT NULL,
                    journey_name  TEXT,
                    sample_id     TEXT,
                    sample_label  TEXT,
                    card_index    INTEGER,
                    stage_index   INTEGER,
                    stage_id      TEXT,
                    algorithm     TEXT,
                    renderer      TEXT,
                    elapsed_ms    INTEGER,
                    client_ts     INTEGER,
                    server_ts     TEXT    NOT NULL,
                    -- Device CLASS, not User-Agent. See event_collector.js
                    -- for why: the full UA is a fingerprinting vector, the
                    -- class is shared by thousands of users and answers
                    -- the UX question just as well.
                    platform      TEXT,
                    os_family     TEXT,
                    browser       TEXT,
                    viewport_band TEXT,
                    dpr           INTEGER
                )
            """)
            # Indexes chosen to match the four queries below -- each one
            # groups by journey, by sample, or filters by session.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_journey ON events(journey_name)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sample  ON events(sample_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_session ON events(session_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pairing ON events(journey_name, sample_label)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_device  ON events(platform, os_family)")

    # ── Write ───────────────────────────────────────────────────────────

    def record_batch(self, events: list) -> dict:
        """
        Insert a batch. Returns {"accepted": n, "rejected": n}.

        Invalid rows are skipped rather than failing the whole batch --
        one malformed event from a stale client build should not discard
        the nineteen good ones alongside it.
        """
        now      = datetime.now(timezone.utc).isoformat()
        rows     = []
        rejected = 0

        for e in events:
            if not isinstance(e, dict):
                rejected += 1
                continue
            if e.get("event") not in self.VALID_EVENTS:
                rejected += 1
                continue
            if not e.get("session_id"):
                rejected += 1
                continue
            rows.append((
                str(e["session_id"])[:64],
                e["event"],
                e.get("journey_name"),
                e.get("sample_id"),
                e.get("sample_label"),
                e.get("card_index"),
                e.get("stage_index"),
                e.get("stage_id"),
                e.get("algorithm"),
                e.get("renderer"),
                e.get("elapsed_ms"),
                e.get("client_ts"),
                now,
                e.get("platform"),
                e.get("os_family"),
                e.get("browser"),
                e.get("viewport_band"),
                e.get("dpr"),
            ))

        if rows:
            with self._lock, self._connect() as conn:
                conn.executemany("""
                    INSERT INTO events (
                        session_id, event, journey_name, sample_id,
                        sample_label, card_index, stage_index, stage_id,
                        algorithm, renderer, elapsed_ms, client_ts, server_ts,
                        platform, os_family, browser, viewport_band, dpr
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, rows)

        return {"accepted": len(rows), "rejected": rejected}

    # ── Read: the four questions the recommender asks ───────────────────

    def journey_performance(self) -> list:
        """
        Q1: how does each journey TYPE perform?
        completion_rate = stage_completed / card_entered
        """
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT journey_name,
                       SUM(event = 'card_entered')    AS entered,
                       SUM(event = 'stage_completed') AS completed,
                       SUM(event = 'restarted')       AS replays,
                       COUNT(DISTINCT sample_id)      AS distinct_samples
                FROM events
                WHERE journey_name IS NOT NULL
                GROUP BY journey_name
            """)]

    def sample_performance(self, limit: int = 50) -> list:
        """
        Q2: which individual RECORDS hold attention?
        High replay count means an interesting signal worth surfacing.
        """
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT sample_id, sample_label,
                       SUM(event = 'card_entered') AS views,
                       SUM(event = 'restarted')    AS replays
                FROM events
                WHERE sample_id IS NOT NULL
                GROUP BY sample_id, sample_label
                ORDER BY replays DESC, views DESC
                LIMIT ?
            """, (limit,))]

    def session_label_coverage(self, session_id: str) -> dict:
        """
        Q3: what has THIS session already seen?
        Drives contrast sequencing -- three normals in a row means the
        next card should be an AFib, not a fourth normal.
        """
        with self._connect() as conn:
            rows = conn.execute("""
                SELECT sample_label, COUNT(DISTINCT sample_id) AS n
                FROM events
                WHERE session_id = ? AND event = 'card_entered'
                  AND sample_label IS NOT NULL
                GROUP BY sample_label
            """, (session_id,)).fetchall()
        return {r["sample_label"]: r["n"] for r in rows}

    def pairing_performance(self) -> list:
        """
        Q4: how does each (journey x label) COMBINATION perform?

        The one that neither dimension shows alone -- e.g. "DWT on noisy
        records gets skipped, DWT on AFib records gets replayed". This is
        what the recommender uses to choose a journey AND a sample
        together rather than independently.
        """
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT journey_name, sample_label,
                       SUM(event = 'card_entered')    AS entered,
                       SUM(event = 'stage_completed') AS completed,
                       SUM(event = 'restarted')       AS replays
                FROM events
                WHERE journey_name IS NOT NULL AND sample_label IS NOT NULL
                GROUP BY journey_name, sample_label
                ORDER BY entered DESC
            """)]

    def device_performance(self) -> list:
        """
        Q5: does the experience hold up across devices?

        The question this answers: "ECG completes at 78% on desktop but
        34% on iOS" -- a difference journey-level stats hide entirely,
        because they average the two into a number describing neither.

        Grouped by (journey x platform x os_family) so a journey that
        works everywhere is distinguishable from one that only works on
        big screens. avg_elapsed_ms is a proxy for engagement: a card
        abandoned after 2s reads very differently from one watched to
        the end.
        """
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT journey_name, platform, os_family, browser,
                       SUM(event = 'card_entered')    AS entered,
                       SUM(event = 'stage_completed') AS completed,
                       SUM(event = 'restarted')       AS replays,
                       CAST(AVG(CASE WHEN event = 'card_exited'
                                     THEN elapsed_ms END) AS INTEGER)
                                                      AS avg_elapsed_ms
                FROM events
                WHERE journey_name IS NOT NULL AND platform IS NOT NULL
                GROUP BY journey_name, platform, os_family, browser
                ORDER BY entered DESC
            """)]

    def recent_events(self, limit: int = 100, session_id: str | None = None) -> list:
        """
        Raw event stream, newest first -- for eyeballing what is actually
        being collected rather than only aggregates.

        Both timestamps are returned because they answer different
        questions. server_ts is when the row landed and is trustworthy.
        client_ts is the browser's clock, which can be wrong -- but it
        preserves ORDERING WITHIN A BATCH, and since events buffer for up
        to 15s before flushing, everything in one batch shares nearly the
        same server_ts. Without client_ts the sequence inside a batch is
        lost.
        """
        sql = """
            SELECT id, server_ts, client_ts, session_id, event,
                   journey_name, sample_id, sample_label, card_index,
                   stage_index, stage_id, elapsed_ms,
                   platform, os_family, browser
            FROM events
        """
        # Annotated explicitly: without it the type is inferred as
        # list[str] from the first append, and appending `limit` (an int)
        # then reads as an error. SQLite parameters are genuinely mixed
        # types, so list[Any] is the honest annotation.
        params: list[Any] = []
        if session_id:
            sql += " WHERE session_id = ?"
            params.append(session_id)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        with self._connect() as conn:
            return [dict(r) for r in conn.execute(sql, params)]

    def sessions(self, limit: int = 30) -> list:
        """
        One row per session: when it ran, how long, what device, how much
        was watched. The entry point for "show me what someone actually
        did" before drilling into recent_events(session_id=...).
        """
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT session_id,
                       MIN(server_ts)                  AS started_at,
                       MAX(server_ts)                  AS last_seen_at,
                       COUNT(*)                        AS events,
                       COUNT(DISTINCT sample_id)       AS cards_seen,
                       COUNT(DISTINCT journey_name)    AS journeys_seen,
                       SUM(event = 'stage_completed')  AS stages_completed,
                       SUM(event = 'restarted')        AS replays,
                       MAX(platform)                   AS platform,
                       MAX(os_family)                  AS os_family,
                       MAX(browser)                    AS browser
                FROM events
                GROUP BY session_id
                ORDER BY MAX(id) DESC
                LIMIT ?
            """, (limit,))]

    def activity_by_hour(self, hours: int = 24) -> list:
        """Event volume per hour -- confirms data is still arriving."""
        with self._connect() as conn:
            return [dict(r) for r in conn.execute("""
                SELECT substr(server_ts, 1, 13) AS hour,
                       COUNT(*)                 AS events,
                       COUNT(DISTINCT session_id) AS sessions
                FROM events
                GROUP BY hour
                ORDER BY hour DESC
                LIMIT ?
            """, (hours,))]

    def total_events(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
