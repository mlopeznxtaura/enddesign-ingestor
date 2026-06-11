// samples.js - built-in design specs for quick testing

export const SAMPLES = {
  dashboard: `UI Design: SaaS Analytics Dashboard

Screens:
- Header: [Logo] [Nav: Overview, Reports, Settings] [User Avatar > Dropdown: Profile, Logout]
- Sidebar filter: [Date range picker] [Segment selector] [Apply button]
- Main: [KPI cards: Revenue, MAU, Churn, LTV] [Line chart: revenue over time] [User table: sortable, paginated]
- Table row actions: [View profile] [Export row] [Delete user]
- Export button: [Export CSV] [Export PDF]
- Empty state: [Illustration] [Create first record CTA]`,

  agent: `Workflow: Autonomous Agent Loop

Trigger: prompt.md loaded
Steps:
1. Parse task list from prompt.md
2. Check task_status.json -- skip completed
3. Select next pending task
4. Determine required tools/capabilities
5. Execute task (code gen / file write / API call)
6. Update task_status.json with result + hash
7. If all tasks done -> emit completion signal
8. Else -> loop back to step 3

Error handling:
- On failure: write error to status, increment retry counter
- After 3 retries: mark as BLOCKED, continue loop`,

  oauth: `OAuth Provider Connection Flow

UI:
- Provider grid: [Google] [GitHub] [Twitter] [Instagram] [Discord] [Meta]
- Each provider card: [Logo] [Connected badge | Connect button]
- Connect flow: [Redirect to provider] [Callback handler] [Token storage]
- Credential lifetime: tokens expire after workflow window closes
- Scope selector: [Read] [Write] [Admin] per provider
- Connection status: [Live indicator] [Last synced timestamp] [Revoke button]
- Workflow gate: unlock workflow only when required providers connected`,

  qvrm: `Qvrm Trust Protocol DAG

Root: TrustEvent
+-- AgentIdentity
|   +-- DID resolution
|   +-- CapabilityAttestation
|   +-- ReputationScore (aggregated)
+-- TaskContract
|   +-- TaskSpec (input schema)
|   +-- CompletionCriteria
|   +-- EscrowConditions
+-- ExecutionTrace
|   +-- ChainOfThought capture
|   +-- ToolCallLog
|   +-- OutputHash
+-- GovernanceVote
    +-- QuorumCheck
    +-- VoteCast
    +-- ResolutionEmit`
}