import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { libraryCharge, referenceLimitError } from "../artifacts/api-server/src/services/library-limits.ts";
const requireDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = requireDb("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const base = process.env.PRIVATE_TEST_BASE_URL || "http://localhost:80/api";
const fixturePath = "/tmp/neurotext-private-test-fixtures.json";
const mode = process.argv[2];

assert.equal(libraryCharge("word ".repeat(500), "txt", 10).chargedPages, 1);
assert.equal(libraryCharge("word ".repeat(501), "doc", 10).chargedPages, 4);
assert.equal(libraryCharge("word ".repeat(500), "pdf", 10).chargedPages, 4);
assert.equal(referenceLimitError("word ".repeat(20000)), null);
assert.ok(referenceLimitError("word ".repeat(20001)));
assert.ok(referenceLimitError("x".repeat(120001)));

async function seed() {
  const users = [];
  for (const label of ["A", "B"]) {
    const id = randomUUID(), sid = randomUUID();
    await pool.query("INSERT INTO neurotext_users(id,google_sub,email,name) VALUES($1,$2,$3,$4)", [id, `test:${id}`, `test-${id}@example.invalid`, `Library Test ${label}`]);
    await pool.query("INSERT INTO neurotext_sessions(sid,sess,expire) VALUES($1,$2,$3)", [
      sid, JSON.stringify({ cookie: { originalMaxAge: 3600000, expires: new Date(Date.now()+3600000).toISOString(), httpOnly: true, secure: false, sameSite: "lax" }, userId: id }),
      new Date(Date.now()+3600000),
    ]);
    const signature = createHmac("sha256", process.env.SESSION_SECRET).update(sid).digest("base64").replace(/=+$/, "");
    users.push({ id, sid, cookie: `s:${sid}.${signature}` });
  }
  return users;
}
async function cleanup(users) {
  for (const user of users) {
    await pool.query("DELETE FROM neurotext_sessions WHERE sid=$1 OR sess->>'userId'=$2", [user.sid,user.id]);
    await pool.query("DELETE FROM neurotext_workspaces WHERE session_id=$1", [`user:${user.id}`]);
    await pool.query("DELETE FROM neurotext_usage WHERE session_id=$1", [`user:${user.id}`]);
    await pool.query("DELETE FROM neurotext_users WHERE id=$1", [user.id]);
  }
}
async function request(path, user, method="GET", body, customHeader=true) {
  const res = await fetch(base+path, {
    method, redirect: "manual",
    headers: {
      ...(user ? { Cookie: `neurotext_account=${encodeURIComponent(user.cookie)}` } : {}),
      ...(customHeader ? { "X-Neurotext-Request": "1" } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data; try { data=JSON.parse(text); } catch { data=text; }
  return { status: res.status, data, headers: res.headers };
}
let users = [];
try {
  if (mode === "--cleanup-ui") {
    users = JSON.parse(readFileSync(fixturePath,"utf8"));
    await cleanup(users); users=[];
    unlinkSync(fixturePath);
    console.log("PASS: removed isolated browser-test accounts and sessions.");
  } else if (mode === "--seed-ui") {
    users=await seed();
    writeFileSync(fixturePath, JSON.stringify(users), { mode: 0o600 });
    users=[];
    console.log(`Browser test fixtures written privately to ${fixturePath}; no application login bypass was added.`);
  } else {
    users=await seed();
    const [a,b]=users;
    assert.equal((await request("/auth/me",a)).data.user.id,a.id);
    assert.equal((await request("/auth/me")).data.user,null);
    assert.equal((await request("/library")).status,401);
    assert.equal((await request("/history")).status,401);
    const input={ title:"Private Darwin test", text:"Natural selection requires variation and differential reproduction.", format:"txt",originalBytes:80 };
    assert.equal((await request("/library",a,"POST",input,false)).status,403);
    const created=await request("/library",a,"POST",input);
    assert.equal(created.status,201,JSON.stringify(created.data));
    const id=created.data.id;
    assert.equal((await request(`/library/${id}`,a)).data.text,input.text);
    assert.equal((await request(`/library/${id}`,b)).status,404);
    assert.equal((await request(`/library/${id}`,b,"DELETE")).status,404);
    assert.equal((await request("/library",b)).data.documents.length,0);
    const workspace={instructions:"Test private work",sourceDocument:"",output:"PRIVATE TEST RESULT",targetWords:500,selectedModel:"ZHI 2 · Anthropic Claude",thinker:"",status:"complete",progress:100,provider:"test",skeleton:"",quotationCount:0,generationError:"",instructionDraft:""};
    assert.equal((await request("/functions/workspaces/10",a,"PUT",workspace)).status,200);
    assert.equal((await request("/functions/workspaces/10",a)).data.output,workspace.output);
    assert.equal((await request("/functions/workspaces/10",b)).data.output,"");
    assert.equal((await request("/functions/workspaces/10",null,"PUT",workspace)).status,200);
    assert.equal((await request("/functions/workspaces/10")).data.output,"");
    const works=(await request("/history",a)).data;
    assert.equal(works.length,1);
    assert.equal((await request(`/history/${works[0].id}`,a)).data.workspace.output,workspace.output);
    assert.equal((await request(`/history/${works[0].id}`,b)).status,404);
    assert.equal((await request(`/history/${works[0].id}`,b,"DELETE")).status,404);
    assert.equal((await request("/functions/workspaces/10",a,"PUT",workspace)).status,200);
    assert.equal((await request("/history",a)).data.length,1,"Duplicate autosaves must not duplicate history");
    await request("/functions/workspaces/10",a,"PUT",{...workspace,sourceDocument:"Existing private reference"});
    const ocrTransfer=await request("/functions/transfer",a,"POST",{sourceFunctionId:11,destinationFunctionId:10,document:"New OCR resource"});
    assert.equal(ocrTransfer.status,200);
    assert.equal(ocrTransfer.data.destination.instructions,workspace.instructions);
    assert.equal(ocrTransfer.data.destination.output,workspace.output);
    assert.equal(ocrTransfer.data.destination.sourceDocument,"Existing private reference\n\nNew OCR resource");
    const rejectedTransfer=await request("/functions/transfer",a,"POST",{sourceFunctionId:11,destinationFunctionId:10,document:"word ".repeat(20001)});
    assert.equal(rejectedTransfer.status,413);
    assert.equal((await request("/functions/workspaces/10",a)).data.sourceDocument,"Existing private reference\n\nNew OCR resource");
    const oversize=await request("/functions/stream",null,"POST",{functionId:10,instructions:"Summarize",sourceDocument:"word ".repeat(20001),targetWords:100,selectedModel:"test"});
    assert.equal(oversize.status,413);
    // Simulate a nearly full quota, using only our isolated owner's row.
    await pool.query("UPDATE neurotext_library SET charged_pages=9999 WHERE id=$1",[id]);
    const simultaneous=await Promise.all([request("/library",a,"POST",input),request("/library",a,"POST",input)]);
    assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,413]);
    await pool.query("UPDATE neurotext_library SET charged_pages=1,charged_bytes=52428800 WHERE id=$1",[id]);
    assert.equal((await request("/library",a,"POST",input)).status,413);
    const docx=spawnSync("python3",["-c",`import io,zipfile,base64
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Darwin document extraction test.</w:t></w:r></w:p></w:body></w:document>')
print(base64.b64encode(b.getvalue()).decode())`],{encoding:"utf8"});
    assert.equal(docx.status,0);
    const extracted=await request("/documents/word",a,"POST",{fileName:"test.docx",base64:docx.stdout.trim()});
    assert.equal(extracted.status,200,JSON.stringify(extracted.data));
    assert.match(extracted.data.text,/Darwin document extraction test/);
    assert.equal((await request("/documents/word",a,"POST",{fileName:"bad.doc",base64:Buffer.from("invalid").toString("base64")})).status,422);
    const login=await request("/auth/google");
    assert.equal(login.status,302,JSON.stringify(login.data));
    const location=new URL(login.headers.get("location"));
    assert.equal(location.hostname,"accounts.google.com");
    assert.ok(location.searchParams.get("code_challenge"));
    assert.equal(location.searchParams.get("code_challenge_method"),"S256");
    assert.ok(location.searchParams.get("nonce"));
    assert.ok(login.headers.get("set-cookie")?.includes("HttpOnly"));
    assert.ok(login.headers.get("set-cookie")?.includes("SameSite=Lax"));
    const invalid=await request("/auth/google/callback?state=invalid&code=invalid");
    assert.equal(invalid.status,302);
    assert.match(invalid.headers.get("location"),/authError=google_login_failed/);
    assert.equal((await request("/auth/logout",a,"POST")).status,200);
    assert.equal((await request("/auth/me",a)).data.user,null);
    console.log("PASS: real HTTP checks covered private account isolation, library/history CRUD ownership, guest nonpersistence, quota concurrency/bytes, reference limits, DOCX extraction, OAuth state rejection/PKCE, and logout.");
  }
} finally {
  await cleanup(users);
  await pool.end();
}
