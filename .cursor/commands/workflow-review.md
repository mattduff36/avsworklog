# /workflow-review

1. Run `npm run workflow-review`.
2. Check `Collector wiring`, `Hook delivery`, `Events`, `Latest event`, and `Telemetry confidence` first. If wiring is incomplete, repair the missing project hook component. If delivery is `unverified` or `stale`, confirm the project hook appears in Cursor Settings → Hooks and restart Cursor if necessary. If confidence is `none` or `warming-up`, do not infer workflow trends; complete a substantive task with one valid V4 parent marker, then rerun diagnostics.
3. Summarize lane distribution, selected parent models, anomalies, failed/unknown findings, finalise/repair behavior, and low-confidence estimated premium-token savings. Never claim exact IDE token usage.
4. If a pending follow-up artifact is printed, read it, use AskQuestion to collect approve/reject/skip for every suggestion, then run:
   `npm run automation:followup:resolve -- --pending "<path>" --decision "<id>=approve|reject|skip"`
   with one decision per suggestion.
5. If the resolver prints a Cursor plan path, report that it is ready for review/build.
