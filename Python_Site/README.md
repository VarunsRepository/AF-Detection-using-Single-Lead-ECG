# Python ECG Analysis Application

## Overview

This project provides a **Flask-based web application for single-lead ECG analysis**.

The application provides a web interface through which ECG recordings can be selected, processed and visualised using the underlying Python signal-processing pipeline.

The web application acts as the **access layer to the ECG analysis implementation**: the frontend provides the controls and visualisations, Flask manages communication between the browser and the Python processing engine, and the DSP modules perform the actual ECG analysis.

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
                              index.html
                                    │
                                    │ HTTP requests
                                    ▼
                                Flask
                               app.py
                                    │
                                    │ Loads ECG
                                    │ Builds configuration
                                    │ Calls processing engine
                                    ▼
                              Engine.py
                                    │
                                    │ Processing pipeline
                                    ▼
                         ┌──────────┼──────────┐
                         │          │          │
                         ▼          ▼          ▼
                        DSP        DWT       ECG Analysis
                      modules     modules      functions
                         │          │          │
                         └──────────┼──────────┘
                                    │
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

The **repository is the core item of the application**. It contains the complete implementation required to run the ECG analysis web application, including the Flask backend, processing engine, DSP modules, frontend and supporting resources.

## Flask Web Application

The Flask application provides the **interface between the browser and the ECG-processing implementation**.

The controls exposed by the web application are the medium through which the underlying ECG algorithms can be accessed and their results visualised.

The browser does not directly perform the core ECG analysis. Instead, requests are sent to the Python backend, which executes the appropriate processing pipeline and returns the results.

# Main Application Components

| Component | Description |
|---|---|
| `app.py` | Flask application and HTTP/API routes |
| `Engine.py` | Main ECG-processing pipeline and orchestration layer |
| `DSP_modules/` | Signal-processing and ECG-analysis functions |
| `static/index.html` | Main web interface |
| `static/` | Frontend JavaScript, HTML and supporting assets |
| ECG data | Input ECG recordings used by the application |

# `app.py`

`app.py` is the **Flask application layer**.

Its primary responsibilities are:

- Starting the Flask application
- Serving the web interface
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
   ├── identify ECG sample
   ├── load signal
   ├── read analysis settings
   └── construct configuration
           │
           ▼
       Engine.py
```

# `Engine.py`

`Engine.py` is the **central processing/orchestration layer** of the application.

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

This allows the frontend to construct the interactive visualisations without having to perform the core ECG processing itself.

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
└──────────────────┬───────────────────┘
                   │
                   ▼
             ECG Results
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
│   ├── Engine/
│   │   └── Engine.py
│   │
│   ├── DSP_modules/
│   │   ├── DSP.py
│   │   └── ...
│   │
│   ├── static/
│   │   ├── index.html
│   │   ├── index2.html
│   │   └── ...
│   │
│   └── ...
│
├── notebooks/
├── data/
└── README.md
```

The exact repository contents may contain additional supporting files, notebooks and resources.

# Purpose of the Application

The application provides a unified environment for experimenting with and visualising **single-lead ECG signal processing and atrial-fibrillation-related features**.

Rather than treating the algorithms as isolated scripts, the Flask application provides a common interface through which the processing pipeline can be executed and its intermediate and final results examined interactively.

This is particularly useful for investigating signal characteristics such as:

- ECG morphology
- RR variability
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
                       ▼
                 Flask Web App
                       │
          ┌────────────┴────────────┐
          │                         │
      Configuration             Visualisation
          │                         ▲
          ▼                         │
       Engine.py ───────────────► Results
          │
          ▼
     DSP Modules
          │
     ┌────┼────┬────┬────┐
     ▼    ▼    ▼    ▼    ▼
    ECG  RR   FFT  DWT  QRST
    │
    ▼
Processed ECG Data
```

**In short:** the **repository is the core of the implementation**, the **Flask application provides access to it**, `Engine.py` orchestrates the processing, the **DSP modules perform the signal analysis**, and the frontend provides the interactive interface through which the results can be explored.
