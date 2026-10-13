# External Documents local preview

Double-click **Start-Preview.cmd**, leave its window open, then visit **http://127.0.0.1:4001** in your browser. Close the window or press Ctrl+C to stop the preview.

This is an isolated preview of the real module interface. It uses sample assets and people and does not connect to the hosted app, database, email or storage. The role selector simulates matrix levels for testing; it is not part of production authentication.

Documents are stored in this browser's local database on this PC. Reloading preserves them. Another browser/profile, private browsing, clearing site data or using a different address may show a separate or empty library. Use sample files: this preview is not a backup or the live records system.

Try uploading several PDFs or JPG/PNG images, change their order, add details and link a sample asset. Share with the sample reader, then change the simulated level to check retrieval and management controls. Open/download the combined PDF, reload, search, edit metadata and archive/restore it.

The normal app module is `/external-documents`. Its database/storage migration is included in the normal release workflow. Live access must be configured through the existing permissions matrix; the migration grants no new team access.
