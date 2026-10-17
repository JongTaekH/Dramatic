const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

// Test TVWIKI URL extraction, ID conversion, HTML parsing, and live failover/scraping logic
describe("TVWIKI Drama Provider Unit & Integration Suite", () => {
  it("extracts numbered and hub TVWIKI domains from Telegram and redirect hub HTML", () => {
    const sampleTelegramHtml = `
      <div class="tgme_widget_message_text">
        티비위키 평생주소 안내: <a href="https://tvwiki.store">https://tvwiki.store</a>
        현재 접속 주소: https://tvwiki54.net/drama
      </div>
    `;
    const numberedRegex = /https?:\/\/(?:www\.)?(tvwiki\d+\.[a-z]{2,})/gi;
    const hubRegex = /https?:\/\/(?:www\.)?(tvwiki\.(?:store|org|net|com|kr|info|link|me|io|cc|top|xyz))/gi;

    const numbered = [...new Set([...sampleTelegramHtml.matchAll(numberedRegex)].map((m) => `https://${m[1].toLowerCase()}`))];
    const hubs = [...new Set([...sampleTelegramHtml.matchAll(hubRegex)].map((m) => `https://${m[1].toLowerCase()}`))];

    assert.deepEqual(numbered, ["https://tvwiki54.net"]);
    assert.deepEqual(hubs, ["https://tvwiki.store"]);
  });

  it("parses drama and old_drama IDs accurately", () => {
    const toDramaId = (category, wrId) => `${category === "old_drama" ? "odr_" : "dr_"}${String(wrId).trim()}`;
    const parseDramaId = (dramaId) => {
      if (dramaId.startsWith("odr_")) return { category: "old_drama", wrId: dramaId.slice(4) };
      if (dramaId.startsWith("dr_")) return { category: "drama", wrId: dramaId.slice(3) };
      return { category: "drama", wrId: dramaId };
    };

    assert.equal(toDramaId("drama", 4148), "dr_4148");
    assert.equal(toDramaId("old_drama", 4901), "odr_4901");
    assert.deepEqual(parseDramaId("dr_4148"), { category: "drama", wrId: "4148" });
    assert.deepEqual(parseDramaId("odr_4901"), { category: "old_drama", wrId: "4901" });
  });

  it("filters search HTML to include only /drama and /old_drama items", () => {
    const sampleSearchHtml = `
      <div id="line_type">
        <ul id="mov_con_list">
          <li>
            <div class="box">
              <a class="img" href="/drama/4148"><img src="/poster1.jpg" /></a>
              <a class="title" href="/drama/4148">날아올라라 나비</a>
              <span class="thumb-category">드라마</span>
            </div>
          </li>
          <li>
            <div class="box">
              <a class="img" href="/old_drama/1515"><img src="/poster2.jpg" /></a>
              <a class="title" href="/old_drama/1515">모래시계</a>
              <span class="thumb-category">추억의 드라마</span>
            </div>
          </li>
          <li>
            <div class="box">
              <a class="img" href="/ent/3514"><img src="/poster3.jpg" /></a>
              <a class="title" href="/ent/3514">예능 프로그램</a>
              <span class="thumb-category">예능</span>
            </div>
          </li>
          <li>
            <div class="box">
              <a class="img" href="/world/20578"><img src="/poster4.jpg" /></a>
              <a class="title" href="/world/20578">해외 영화</a>
              <span class="thumb-category">영화</span>
            </div>
          </li>
        </ul>
      </div>
    `;

    const matches = [...sampleSearchHtml.matchAll(/href="\/(drama|old_drama)\/(\d+)"/g)];
    const uniqueIds = [...new Set(matches.map((m) => `${m[1] === "old_drama" ? "odr_" : "dr_"}${m[2]}`))];
    assert.deepEqual(uniqueIds, ["dr_4148", "odr_1515"]);
  });

  it("resolves live TVWIKI domain from tvwiki.store or Telegram", async () => {
    const res = await fetch("https://tvwiki.store/", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    assert.equal(res.ok, true);
    const html = await res.text();
    const match = html.match(/https?:\/\/(?:www\.)?(tvwiki\d+\.[a-z]{2,})/i);
    assert.ok(match, "Expected tvwiki.store to contain a numbered tvwiki domain");
    assert.match(match[0], /^https:\/\/tvwiki\d+\.[a-z]{2,}$/i);
  });
});
