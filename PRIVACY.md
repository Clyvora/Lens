# Privacy

Clyvora Lens is designed so file contents stay on the device where the app is opened.

## What the app processes

When a user opens or pastes JSON, CSV, or text, the browser reads and processes that data locally. Parsing, inspection, search, filtering, sorting, conversion, copying, and download creation happen in the browser. File contents are not sent to Clyvora or any third party by the application.

## Data collection

Clyvora Lens does not include:

- accounts or authentication;
- analytics or advertising;
- telemetry or error-reporting services;
- a backend or database;
- cloud storage;
- external APIs or AI services; or
- logging of file contents.

The app stores conversion preferences in the browser's `localStorage`. Those preferences contain settings such as delimiter and line-ending choices, not file contents. They can be removed by clearing site data in the browser.

## Hosting note

A website host may process normal connection information, such as an IP address and request headers, when serving the static app files. That hosting-layer activity is separate from Clyvora Lens's file processing: files opened in the workbench are not uploaded to the host.

If a future contribution changes these guarantees, it must be clearly disclosed and reviewed before release.
