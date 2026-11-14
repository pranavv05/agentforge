# Quickstart

Create a spec, answer the agent's questions, approve two gates and unlock implementation. It takes about five minutes.

## 1. Create a workspace

[Sign in](/login) or [create an account](/signup). If you only want a look around first, choose **Explore with a demo workspace** on the sign-in page. It comes with a spec already waiting for your answers.

## 2. Create a spec

Open **New spec** in the dashboard and fill in:

| Field | What to enter |
|---|---|
| Title | A short name, for example `Auto TDS on vendor payments` |
| Description | What the feature should do. Short sentences become separate requirements. |
| Project type | **New project** skips code analysis. **Existing codebase** adds a context stage that scans the repository and verifies claims. |
| Cost cap | The most a single run may spend. Default is $2. |

Select **Create spec**. The agents run and stop at the first gate.

## 3. Answer the clarifying questions

The requirements agent asks questions it cannot answer from your description. Answer each one and submit. Drafting resumes.

## 4. Approve requirements

Open the **Requirements** tab and review the document. Then choose **Approve requirements**, **Request changes** or **Reject** (a comment is required for the last two). Your decision is recorded against the document's SHA-256 hash. If the document changed after you opened it, the decision is refused.

## 5. Approve the design

The design agent drafts a design from the approved requirements. For an existing codebase, check the **unverified-claim rate** at the top of the Design tab before approving.

## 6. Implement

Once both approvals are recorded the spec becomes **Ready to implement**. The edit hook switches from `deny` to `allow`, and tasks can be completed with evidence from the **Tasks** tab.

## Do it with the API

```bash
# sign in and keep the session cookie
curl -c jar.txt -X POST https://YOUR_HOST/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@company.com","password":"your-password"}'

# create a spec
curl -b jar.txt -X POST https://YOUR_HOST/api/specs \
  -H 'content-type: application/json' \
  -d '{"title":"Auto TDS on vendor payments","description":"Deduct TDS on contractor payments and show it on each payment.","case_type":"B"}'
```

See the [API reference](/docs/api) for every endpoint.
