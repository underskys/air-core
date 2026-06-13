const mode = process.argv[2] || "check";

const projectId = process.env.CI_PROJECT_ID;
const mrIid = process.env.CI_MERGE_REQUEST_IID;
const apiBase = process.env.CI_API_V4_URL || "https://gitlab.com/api/v4";
const labelsFromEnv = splitLabels(process.env.CI_MERGE_REQUEST_LABELS || "");
const skipLabels = new Set(["skip-approval", "skip approval", "approval-skip"]);
const autoMergeLabels = new Set(["auto-merge", "automerge"]);

if (!projectId || !mrIid) {
  console.log("not a merge request pipeline; skipping MR policy");
  process.exit(0);
}

const token =
  process.env.GITLAB_API_TOKEN ||
  process.env.GITLAB_TOKEN ||
  process.env.GITLAB_PRIVATE_TOKEN ||
  process.env.GL_TOKEN ||
  process.env.CI_JOB_TOKEN;

if (hasAny(labelsFromEnv, skipLabels)) {
  console.log(`MR !${mrIid}: approval check bypassed by skip-approval label`);
  process.exit(0);
}

if (!token) {
  fail("MR policy requires a GitLab token. Set CI_JOB_TOKEN/GITLAB_API_TOKEN or add skip-approval label by agreement.");
}

try {
  if (mode === "check") {
    await checkApprovalPolicy();
  } else if (mode === "auto-merge") {
    await autoMerge();
  } else {
    fail(`unknown mode '${mode}'`);
  }
} catch (error) {
  fail(error.message || String(error));
}

async function checkApprovalPolicy() {
  const mr = await gitlabGet(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`);
  const labels = new Set([...labelsFromEnv, ...splitLabels((mr.labels || []).join(","))]);
  if (hasAny(labels, skipLabels)) {
    console.log(`MR !${mrIid}: approval check bypassed by skip-approval label`);
    return;
  }

  const approvals = await gitlabGet(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/approvals`);
  const approvedBy = Array.isArray(approvals.approved_by) ? approvals.approved_by : [];
  const approvalCount = approvedBy.length;

  if (approvalCount < 1) {
    fail(
      `MR !${mrIid} requires at least 1 approval. ` +
        `Current approvals: ${approvalCount}. Add one reviewer approval or apply skip-approval by agreement.`
    );
  }

  console.log(`MR !${mrIid}: approval policy passed with ${approvalCount} approval(s)`);
}

async function autoMerge() {
  await checkApprovalPolicy();
  const mr = await gitlabGet(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`);
  const labels = new Set([...labelsFromEnv, ...splitLabels((mr.labels || []).join(","))]);
  const requested = process.env.AIR_AUTO_MERGE === "1" || hasAny(labels, autoMergeLabels);

  if (!requested) {
    console.log(`MR !${mrIid}: auto-merge not requested; add auto-merge label or AIR_AUTO_MERGE=1`);
    return;
  }

  const payloads = [
    { auto_merge: true, should_remove_source_branch: true },
    { merge_when_pipeline_succeeds: true, should_remove_source_branch: true }
  ];

  let lastError = null;
  for (const payload of payloads) {
    try {
      await gitlabPut(`/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/merge`, payload);
      console.log(`MR !${mrIid}: auto-merge requested`);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  fail(`MR !${mrIid}: failed to request auto-merge: ${lastError?.message || "unknown error"}`);
}

async function gitlabGet(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(`GitLab GET ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function gitlabPut(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "PUT",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`GitLab PUT ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function authHeaders() {
  if (process.env.CI_JOB_TOKEN && token === process.env.CI_JOB_TOKEN) return { "JOB-TOKEN": token };
  return { "PRIVATE-TOKEN": token };
}

function splitLabels(value) {
  return new Set(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function hasAny(labels, expected) {
  for (const label of labels) {
    if (expected.has(label.toLowerCase())) return true;
  }
  return false;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
