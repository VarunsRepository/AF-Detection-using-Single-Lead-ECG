# Python ECG Analysis Application

## Overview

This project provides a **Flask-based web application for single-lead ECG analysis**.

The application provides a web interface through which ECG recordings can be selected, processed and visualised using the underlying Python signal-processing pipeline.

The web application acts as the **access layer to the ECG analysis implementation**: the frontend provides the controls and visualisations, Flask manages communication between the browser and the Python processing engine, and the DSP modules perform the actual ECG analysis.

The application also contains **ECG Shorts**, a vertical, interactive ECG exploration experience that presents real ECG recordings as a sequence of progressively more informative processing stages. Rather than showing only a final chart or result, ECG Shorts allows the viewer to move through the signal-processing journey from the raw waveform to a final verdict.

---

## Application Architecture

```text
                           PYTHON ECG APPLICATION
                                    │
                                    ▼
                              Web Browser
                                    │
                                    │ User controls
                                    │ ECG selection
                                    │ Analysis options
                                    ▼
                              Flask
                               app.py
                                    │
                       ┌────────────┴────────────┐
                       │                         │
                       ▼                         ▼
                  Main Analysis              ECG Shorts
                       │                         │
                       ▼                         ▼
                    Engine.py              Shorts Blueprint
                       │                         │
                       ▼                         ▼
                  DSP Modules          Browser Stage Pipeline
                       │                         │
                       └────────────┬────────────┘
                                    ▼
                              Results / JSON
                                    │
                                    ▼
                              Web Browser
                                    │
                                    ▼
                         Interactive visualisation
```

---

# Core Components

## Repository

The **repository is the core item of the application**. It contains the complete implementation required to run the ECG analysis web application, including the Flask backend, processing engine, DSP modules, frontend, ECG Shorts experience and supporting resources.

## Flask Web Application

The Flask application provides the **interface between the browser and the ECG-processing implementation**.

The controls exposed by the web application are the medium through which the underlying ECG algorithms can be accessed and their results visualised.

The browser does not directly perform the main Python ECG analysis. Instead, requests are sent to the Python backend, which executes the appropriate processing pipeline and returns the results.

# Main Application Components

| Component | Description |
|---|---|
| `app.py` | Flask application and HTTP/API routes |
| `Engine.py` | Main ECG-processing pipeline and orchestration layer |
| `DSP_modules/` | Signal-processing and ECG-analysis functions |
| `Blueprints/shorts_bp.py` | Flask blueprint serving the ECG Shorts page and its data APIs |
| `static/index.html` | Main ECG analysis web interface |
| `static/shorts/` | Modular JavaScript and CSS implementation of ECG Shorts |
| `templates/shorts/` | HTML shell for the ECG Shorts feed |
| ECG data | Input ECG recordings used by the application |

# `app.py`

`app.py` is the **Flask application layer**.

Its primary responsibilities are:

- Starting the Flask application
- Serving the web interface
- Registering application blueprints
- Receiving requests from the frontend
- Loading the requested ECG recording
- Building the processing configuration
- Passing the ECG signal to `Engine.py`
- Returning processed results to the frontend

Conceptually:

```text
Browser
   │
   │ HTTP request
   ▼
app.py
   │
   ├── Main ECG analysis routes
   └── ECG Shorts blueprint
           │
           ▼
       Processing / Data APIs
```

# `Engine.py`

`Engine.py` is the **central processing/orchestration layer** of the main application.

It sits between the Flask application and the underlying DSP functions.

Its purpose is to take the ECG signal and configuration supplied by Flask and execute the appropriate sequence of processing operations.

Conceptually:

```text
ECG signal
    │
    ▼
Engine.py
    │
    ├── Signal preparation
    ├── P/Q/R/S/T detection
    ├── QRST processing/cancellation
    ├── Wavelet decomposition
    ├── FFT / spectral analysis
    ├── RR / Poincaré analysis
    └── Result preparation
    │
    ▼
JSON payload
    │
    ▼
Frontend
```

This makes `Engine.py` an important separation layer: **Flask handles the web application, while the engine coordinates the ECG analysis.**

# DSP Modules

The DSP modules contain the underlying signal-processing implementations used by the engine.

Depending on the selected analysis, these functions perform operations including:

- ECG filtering
- R-peak detection
- P/Q/R/S/T identification
- QRST cancellation
- Discrete Wavelet Transform (DWT)
- Fast Fourier Transform (FFT)
- RR interval analysis
- Poincaré analysis
- Spectral feature extraction

The engine calls these functions rather than implementing every algorithm itself.

This keeps the application architecture modular:

```text
Engine.py
    │
    ├── DSP function
    ├── Wavelet function
    ├── FFT function
    ├── ECG detection function
    └── RR analysis function
```

# Web Interface

The main frontend is implemented in:

```text
Python_Site/static/index.html
```

The interface provides controls for selecting ECG samples and configuring the analysis.

The frontend is responsible for:

- Sample selection
- Processing configuration
- Interactive plots
- ECG waveform visualisation
- P/Q/R/S/T markers
- Wavelet visualisation
- FFT/spectral visualisation
- RR/Poincaré visualisation
- Displaying analysis results

The frontend communicates with Flask using HTTP requests and receives processed ECG information from the backend.

---

# ECG Shorts

## Overview

**ECG Shorts** is a separate interactive experience within the Python application that presents ECG analysis in a vertical, short-form format inspired by the interaction model of modern content feeds.

Each card represents a real ECG recording. As the user interacts with a card, the recording progresses through a series of processing stages rather than immediately displaying a final answer.

The current five-stage pipeline is:

```text
Stage 0                  Stage 1                 Stage 2
Raw ECG                  Baseline Correction     Peak Detection
    │                         │                       │
    └─────────────────────────┴───────────────────────┘
                              │
                              ▼
                          Stage 3
                         HRV Metrics
                              │
                              ▼
                          Stage 4
                           Verdict
```

In plain English:

```text
Your Heartbeat
      ↓
Cleaning It Up
      ↓
Finding the Heartbeats
      ↓
Measuring the Rhythm
      ↓
Showing the Verdict
```

This design allows ECG Shorts to expose the **intermediate transformations of an ECG signal**, rather than treating signal processing as an invisible black box.

## ECG Shorts Architecture

```text
                 Flask Application
                         │
                         ▼
                  shorts_bp.py
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       /shorts feed          ECG data APIs
              │                     │
              ▼                     ▼
     shorts_feed.html      PhysioNet registry
              │                     │
              └──────────┬──────────┘
                         ▼
                    Browser Feed
                         │
                         ▼
                  shorts_feed.js
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Core        Filters     Features
              │          │          │
              └──────────┼──────────┘
                         ▼
                 Interactive ECG Card
```

The backend supplies real recordings and labels, while the browser manages the staged presentation, signal transformations and interactive visualisations.

## Flask Blueprint and APIs

ECG Shorts is served through `Blueprints/shorts_bp.py`.

The blueprint provides the page shell and APIs used by the browser to retrieve recordings:

| Endpoint | Purpose |
|---|---|
| `/shorts/` | Serves the ECG Shorts feed page |
| `/shorts/api/samples` | Returns a paginated collection of playable ECG records and labels |
| `/shorts/api/sample/<sample_id>/raw` | Returns the raw signal and sampling frequency for a specific ECG record |

The current raw-signal API returns recordings from the application's PhysioNet registry. The ECG Shorts frontend currently works with a sampling frequency of **300 Hz**.

## The Stage Engine

The central architectural component of ECG Shorts is:

```text
static/shorts/core/stage_engine.js
```

The stage engine provides a generic framework through which processing stages can be registered and executed.

Each stage can define:

```text
Stage Definition
│
├── processor  → Calculates the stage output
├── renderer   → Displays or animates the output
├── dependsOn  → Declares which earlier stage provides its input
└── label      → Provides shared descriptive metadata
```

Conceptually:

```text
Stage 0 Output
      │
      ▼
Stage 1 Processor
      │
      ▼
Stage 1 Output
      │
      ▼
Stage 2 Processor
      │
      ▼
Stage 2 Output
```

The dependency is declared explicitly rather than being assumed from the numerical order of stages. This means the architecture can support both linear pipelines and future branches that begin from the raw ECG signal.

The engine also caches processor outputs per sample. If a user revisits a stage without changing the underlying signal or algorithm, the existing calculation can be reused while the animation itself restarts cleanly.

## The Current ECG Shorts Pipeline

### Stage 0 — Raw ECG Signal

Stage 0 is the entry point into the browser-side pipeline. It receives the raw ECG recording, optionally applies per-sample inversion and creates the time axis used for visualisation.

The signal is displayed as an animated five-second sliding ECG window.

### Stage 1 — Baseline Correction

Stage 1 receives Stage 0's waveform and removes slow baseline drift caused by factors such as breathing, movement or electrode contact.

The current implementation uses a low-cutoff high-pass filter so the wandering baseline is reduced while the main ECG morphology is retained.

### Stage 2 — Peak Detection

Stage 2 receives the corrected ECG waveform and detects the locations of heartbeats, represented by R-peak markers.

The peak detector is interchangeable: the stage asks the detector registry for the currently selected algorithm rather than directly depending on one fixed implementation.

### Stage 3 — HRV Metrics

Stage 3 uses the detected R-peaks to calculate RR intervals and heart-rate-variability measurements.

The metrics include mean heart rate, SDNN, RMSSD, pNN50 and Poincaré-derived SD1/SD2 values, along with consecutive RR interval pairs for Poincaré analysis.

### Stage 4 — Verdict

Stage 4 represents the final stage of the current ECG Shorts pipeline. It combines the preceding analysis with the record's associated class label to present the card's conclusion.

The architecture allows the verdict stage to evolve independently as additional analysis or classification logic is introduced.

## `shorts_feed.js` — The Feed Entry Point

`shorts_feed.js` is the main entry point for the ECG Shorts frontend.

Its responsibilities include:

- Fetching real sample IDs and labels from the backend
- Dynamically creating ECG cards
- Building the stage navigation structure
- Loading additional cards as the user scrolls
- Connecting cards to the shared visibility observer
- Wiring the right-side control rail
- Managing session-level viewing statistics
- Starting the feed after optional onboarding

Conceptually:

```text
Backend sample list
        │
        ▼
shorts_feed.js
        │
        ├── Build ECG cards
        ├── Register card controllers
        ├── Watch visible card
        ├── Load more records
        └── Connect rail controls
                │
                ▼
           ECG Shorts Feed
```

Cards are loaded in pages, allowing the feed to expand as the user scrolls rather than constructing the entire ECG collection in the browser at once.

## `stage_machine.js` — Card Progression

Each ECG card has its own stage controller implemented by `stage_machine.js`.

The stage machine manages:

- Entering a stage
- Automatic progression to the next stage
- Restarting the current stage
- Returning to a previous stage
- Pause and resume behaviour
- Progress-bar animation
- Restarting a card from Stage 0 when it becomes visible again

The central principle is that every form of stage navigation passes through a single canonical stage-entry mechanism.

```text
Visible Card
    │
    ▼
Stage 0
    │
    ├── Tap right  → Next stage
    ├── Tap left   → Restart / previous stage
    └── Centre tap → Pause / resume
```

A card deliberately starts fresh from Stage 0 whenever it becomes visible again; the system does not preserve cross-visit progression state.

## `stage_renderers.js` — Processing and Visualisation Bridge

`stage_renderers.js` connects the generic stage engine to the actual ECG visualisations.

It currently:

- Fetches and caches raw ECG signals
- Creates consistent Plotly chart layouts
- Drives animated sliding-window sweeps
- Registers the current pipeline stages with the stage engine
- Renders waveform and peak-detection visualisations
- Coordinates stage-specific animations

The file separates **what a stage computes** from **how that stage is shown**.

```text
Processor Output
       │
       ▼
Stage Renderer
       │
       ├── Build Plotly chart
       ├── Configure ECG window
       └── Animate the sweep
               │
               ▼
          Browser Display
```

## `rail_controls.js` — User Controls

The right-hand control rail contains global and per-sample controls.

The current controls are:

| Control | Behaviour |
|---|---|
| Speed | Changes the duration of stage animations globally |
| Theme | Cycles between predefined visual themes globally |
| Invert | Flips the polarity of one specific ECG sample |
| Algorithm | Switches the active peak-detection algorithm globally |

The file also owns the central stage-duration logic, ensuring the stage machine and chart animations use the same timing rules.

An important distinction is made between cosmetic and computational changes:

```text
Theme / Speed
      │
      └── Visual behaviour changes
          Cached ECG calculations remain valid

Invert / Peak Detector
      │
      └── Signal or processing output changes
          Affected cached stages must be recalculated
```

## `peak_detector_registry.js` — Interchangeable Algorithms

The peak detector registry is the catalogue of available R-peak detection algorithms.

Every detector follows the same contract:

```text
ECG Signal + Sampling Frequency
             │
             ▼
        Detector
             │
             ▼
{ peakIndices, steps }
```

The current registry contains:

- Pan-Tompkins
- Hamilton-Tompkins

Because Stage 2 requests the selected detector through the registry, another compatible peak detector can be added without rewriting the stage renderer itself.

Changing the selected detector invalidates Stage 2 and downstream cached outputs because those results were generated using the previously selected algorithm.

## Signal-Processing Filters

The `static/shorts/filters/` directory contains browser-side, pure-computation algorithms. These files contain signal-processing logic without UI or rendering responsibilities.

### `baseline_correction_filter.js`

Removes slow baseline wander using a high-pass filtering approach. It provides the cleaned waveform used by the later stages of the current pipeline.

### `pan_tompkins_filter.js`

Implements the Pan-Tompkins-based heartbeat detection process and returns detected peak locations along with intermediate processing steps.

Those intermediate steps can also be used by the ECG Shorts algorithm explainer to show how the detector transforms the original signal.

### `hamilton_tompkins_filter.js`

Provides the Hamilton-Tompkins alternative for R-peak detection.

It follows the same output contract as the other registered detector so that Stage 2 can switch algorithms without changing its surrounding pipeline.

### `hrv_metrics_filter.js`

Transforms detected peak locations into RR intervals and time-domain and Poincaré HRV measurements.

It returns both numerical metrics and the consecutive RR interval pairs required for Poincaré-style analysis.

## Educational Features

The `static/shorts/features/` directory contains optional features intended to help users understand the ECG pipeline rather than merely operate it.

### `onboarding.js`

Provides a one-time introductory walkthrough before the feed begins. The onboarding slides are generated from the stages' own registered labels, ensuring that the explanation remains synchronised with the actual pipeline.

### `algorithm_explainer.js`

Provides an opt-in explanation panel for the peak-detection stage.

A viewer can first read a plain-English explanation and then inspect the algorithm's intermediate transformations as full, static plots of the complete recording:

```text
ECG Signal
    │
    ▼
Band-pass Filtering
    │
    ▼
Derivative
    │
    ▼
Squaring
    │
    ▼
Integration
    │
    ▼
Detected Peaks
```

The explainer reuses Stage 2's existing cached result rather than independently recomputing the algorithm.

## ECG Shorts Data and Caching Flow

The ECG Shorts architecture uses caching at two levels.

```text
                         Backend
                            │
                            ▼
                     Raw ECG Request
                            │
                            ▼
                   Raw Signal Cache
                            │
                            ▼
                     Stage Engine
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       Stage Output Cache             Renderer
              │                           │
              ▼                           ▼
      Reuse calculations          Restart animation
```

This means a user can revisit a stage and receive a fresh visual experience without unnecessarily rerunning the underlying ECG calculations.

The cache is selectively invalidated when a change affects the actual data or processing output.

## Adding a Future Stage

The stage architecture is designed to be extensible.

A new stage does not require the central engine to be rewritten. Instead, the stage can register its own definition:

```text
New Stage
    │
    ├── Declare dependency
    ├── Provide processor
    ├── Provide renderer
    └── Provide descriptive label
            │
            ▼
      registerStage(...)
            │
            ▼
      Stage Engine
```

The same stage metadata can then supply the stage bar, onboarding and contextual captions, reducing the number of independent locations that must be updated when the pipeline grows.

---

# ECG Processing Flow

A typical analysis follows this sequence:

```text
1. Select ECG sample
          │
          ▼
2. Frontend sends request
          │
          ▼
3. Flask receives request
          │
          ▼
4. ECG recording is loaded
          │
          ▼
5. Configuration is created
          │
          ▼
6. Engine.py receives signal
          │
          ▼
7. Signal processing
          │
          ├── Filtering
          ├── P/Q/R/S/T detection
          ├── QRST cancellation
          ├── DWT
          ├── FFT
          └── RR analysis
          │
          ▼
8. Results assembled
          │
          ▼
9. JSON returned to browser
          │
          ▼
10. Frontend visualises results
```

# Signal Length

The application supports different processing windows.

At the application's **300 Hz sampling frequency**:

| Processing option | Samples | Approx. duration |
|---|---:|---:|
| Short Sample | 2,500 | 8.3 s |
| 30 Second Sample | 9,000 | 30 s |
| Full Sample | Entire recording | Recording dependent |

The **Full Sample** option allows recordings longer than 30 seconds to be processed without the application artificially truncating them to 9,000 samples.

For example:

```text
18,000 samples
       │
       ▼
300 samples/second
       │
       ▼
60 second ECG
```

The underlying DSP functions are not intrinsically restricted to 9,000 samples; the processing length is controlled by the application/engine configuration.

# Data Returned to the Frontend

The backend packages analysis results into a structured response that can be consumed by the JavaScript frontend.

Depending on the selected processing pipeline, the response can contain information such as:

```text
ECG signal
P/Q/R/S/T indices
R-peaks
RR intervals
Wavelet coefficients
Wavelet bands
FFT data
Spectral features
Poincaré data
Processed / QRST-cancelled signal
```

This allows the frontend to construct the interactive visualisations without having to perform the core Python ECG processing itself.

# Key Design Principle

The application follows a **separation-of-concerns architecture**:

```text
┌──────────────────────────────────────┐
│              Frontend                │
│     User interface & visualisation   │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│              Flask                   │
│       Application / API layer        │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│             Engine.py                │
│      Processing orchestration        │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│           DSP Modules                │
│       ECG signal processing          │
└──────────────────────────────────────┘
```

ECG Shorts applies the same principle inside the browser:

```text
Feed
 │
 ├── Stage Machine     → Interaction and progression
 ├── Stage Engine      → Dependencies and cached computation
 ├── Renderers         → Visual presentation
 ├── Filters           → Pure signal processing
 └── Features          → Education and onboarding
```

This separation makes it possible to modify the frontend, application routing or processing algorithms independently.

# Running the Application

The application is built around Flask and can be run locally using the Python environment containing the project's dependencies.

Typical execution:

```bash
python app.py
```

The Flask server then exposes the web application through the configured host and port.

# Repository Structure

A simplified view of the application is:

```text
AF-Detection-using-Single-Lead-ECG/
│
├── Python_Site/
│   │
│   ├── app.py
│   │
│   ├── Blueprints/
│   │   └── shorts_bp.py
│   │
│   ├── Engine/
│   │   └── Engine.py
│   │
│   ├── DSP_modules/
│   │   ├── DSP.py
│   │   └── ...
│   │
│   ├── templates/
│   │   └── shorts/
│   │       └── shorts_feed.html
│   │
│   ├── static/
│   │   ├── index.html
│   │   ├── index2.html
│   │   │
│   │   └── shorts/
│   │       ├── shorts_feed.js
│   │       ├── shorts_feed.css
│   │       │
│   │       ├── core/
│   │       │   ├── stage_engine.js
│   │       │   ├── stage_machine.js
│   │       │   ├── stage_renderers.js
│   │       │   ├── rail_controls.js
│   │       │   └── peak_detector_registry.js
│   │       │
│   │       ├── filters/
│   │       │   ├── baseline_correction_filter.js
│   │       │   ├── pan_tompkins_filter.js
│   │       │   ├── hamilton_tompkins_filter.js
│   │       │   └── hrv_metrics_filter.js
│   │       │
│   │       └── features/
│   │           ├── onboarding.js
│   │           └── algorithm_explainer.js
│   │
│   └── README.md
│
├── notebooks/
├── data/
└── README.md
```

The exact repository contents may contain additional supporting files, notebooks and resources.

# Purpose of the Application

The application provides a unified environment for experimenting with and visualising **single-lead ECG signal processing and atrial-fibrillation-related features**.

Rather than treating the algorithms as isolated scripts, the Flask application provides a common interface through which the processing pipeline can be executed and its intermediate and final results examined interactively.

The ECG Shorts component extends this idea by presenting ECG processing as a progressive, interactive sequence that exposes intermediate transformations to the user.

This is particularly useful for investigating signal characteristics such as:

- ECG morphology
- Baseline drift and signal correction
- R-peak detection
- RR variability
- Heart-rate variability metrics
- Poincaré-derived measurements
- P/Q/R/S/T morphology
- QRST cancellation
- Wavelet-domain features
- Frequency-domain features
- Spectral energy distribution
- Atrial fibrillatory activity

# Application at a Glance

```text
                 SINGLE-LEAD ECG
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
     Main ECG Analysis             ECG Shorts
          │                           │
          ▼                           ▼
       Flask App                  Flask Blueprint
          │                           │
          ▼                           ▼
       Engine.py                 Stage Pipeline
          │                           │
          ▼                    ┌──────┼──────┐
     DSP Modules                ▼      ▼      ▼
                               Raw   Clean  Peaks
                                      │
                                      ▼
                                  HRV / Verdict
          │
     ┌────┼────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼
    ECG  RR   FFT  DWT  QRST
          │
          ▼
   Interactive Results
```

**In short:** the **repository is the core of the implementation**, the **Flask application provides access to it**, `Engine.py` orchestrates the main ECG-processing pipeline, the **DSP modules perform signal analysis**, and the frontend provides interactive access to the results. **ECG Shorts adds a modular, browser-side stage pipeline that progressively transforms and explains real ECG recordings through signal correction, peak detection, HRV analysis and a final verdict.**
