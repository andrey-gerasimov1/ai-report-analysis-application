# Drop-in report folder

Place `.html`, `.htm`, `.md`, `.markdown`, or `.txt` reports in this directory.

The app discovers filenames automatically, but it does not open or index an unregistered file. New files remain quarantined until you add an entry keyed by the exact filename in `../reports.config.json`, assign `allowedUsers`, and optionally set a simulated checkout price with `priceCents` (the default is `$199 USD`).

All searchable metadata and routing keywords come from that manifest. This keeps authorization ahead of content reads; the registry never opens a locked file merely to infer its title or keywords.

Restart `npm run dev` after adding or removing files so Next.js can include the changed server assets cleanly.
