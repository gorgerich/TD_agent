# Tenant isolation matrix

| Scenario | Expected | Verified |
| --- | --- | --- |
| Organization ADMIN lists own members | 200, own organization only | Integration + E2E PASS |
| Organization ADMIN targets foreign membership | 404 | Integration PASS |
| MANAGER opens team administration API | 403 | Integration + E2E PASS |
| AGENT invites a member | 403 | Integration PASS |
| Tenant payload includes `platformRole=SUPER_ADMIN` | Ignored, DB remains `USER` | Integration PASS |
| Forged cookie role claims `SUPER_ADMIN` | 403 | Integration PASS |
| Suspended membership reuses stale cookie | Operational access denied | Integration PASS |
| Suspended organization reuses stale cookie | Operational access denied | Integration PASS |
| Platform admin detail | No case/document contents selected | Code review PASS |
| Organization search/filter | Server-side platform guard | Integration + review PASS |
