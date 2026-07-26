# Role and capability matrix

| Capability | AGENT | MANAGER | Organization ADMIN | SUPER_ADMIN |
| --- | --- | --- | --- | --- |
| Own operational work | Yes | Yes | Read-only by default | No automatic access |
| Team operational view | No | Yes | Yes | No automatic access |
| Invite AGENT/MANAGER | No | No | Yes | No |
| Assign organization ADMIN | No | No | Yes, reinforced confirmation | No |
| Suspend membership | No | No | Yes, last-admin guard | No |
| Platform dashboard | No | No | No | Yes |
| Read organizations/users | No | No | No | Yes |
| Suspend organization | No | No | No | Yes, explicit confirmation |
| Read client case contents globally | No | No | No | No |
| Assign `SUPER_ADMIN` in UI/API | No | No | No | No |

`SUPER_ADMIN` assignment exists only in the guarded
`ops:bootstrap-platform-super-admin` script.
