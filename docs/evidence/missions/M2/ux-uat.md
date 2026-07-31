# M2 UX and UAT contract

Required UAT journeys:

1. Cremation: Case -> Draft -> Review -> Publish v1 -> Request changes -> Draft
   v2 -> Publish v2 -> Accept -> audit/task outcome.
2. Relative burial: compatible package/add-ons/replacements -> Review -> Publish
   -> print/PDF -> Accept -> audit/task outcome.

Required states include loading, empty, validation, unknown-price blocker,
unknown-cost notice, retryable API failure, conflict, offline recovery,
permission denial, expired/revoked link and superseded version.

Desktop, mobile, keyboard and 200 percent zoom must keep the primary action
visible without horizontal overflow. Critical and serious accessibility findings
must equal zero.

Status: contract locked; isolated Preview UAT pending.
