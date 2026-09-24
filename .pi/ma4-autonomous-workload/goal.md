# Goal: MA4 Autonomous Multi-Agent Workload Qualification

Status: DONE

## Authorized outcome
Use the real canonical Controller policy and Agent catalog to autonomously select specialist profiles and cwd across a concrete implementation, review, remediation, verification, and simple Task workload.

## Scope
- Run the actual Controller AgentSession turn loop against a deterministic faux provider, recording actual list/inspect/create/dispatch tool calls.
- Use separate Task Markdown for implementation, review, remediation, and verification; preserve MA1–MA3 invariants.
- Verify catalog source/override, model/variant, cwd instruction layering, durable Goal/Plan/prerequisite/Task context, assignment generations, session projections, and canonical Controller profile.

## Exclusions
No Task-type routing, scheduler, ExecutionAttempt, shadow context/authority, schema/lifecycle changes, paid/external provider calls, or dependence on prior Execution Session transcript for durable handoff.

## Completion
Deterministic/integration and MA1–MA3 regression gates pass, and `npm run check` passes. Evidence is explicitly separated: the deterministic Controller faux-provider integration proves dispatch plumbing and omitted-agent/default-cwd runtime behavior; the real-provider specialist canary proves autonomous catalog-based `agent` plus contained `cwd` selection and profile/session/context application. A real model is not required to choose generic execution in any particular simple-task canary; that choice is policy variance, not a runtime correctness gate.
