/* global Buffer */

const assert = require("assert");
const http = require("http");
const Payjp = require("../built");

function createTestServer(statusCodes) {
  return http.createServer((msg, res) => {
    const status = statusCodes.next().value[1];
    let obj = {};
    if (status === 200) {
      obj["id"] = "ch_success";
    }
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "application/json",
    });
    res.end(body);
  });
}
describe("Retry delay", () => {
  const r = new Payjp("key", {}).charges;
  it("multiplies by retryCount", () => {
    let got = r["getCurrentDelay"](0, 1000, 2000);
    assert.ok(500 <= got);
    assert.ok(got <= 1000);

    got = r["getCurrentDelay"](2, 1000, 2000);
    assert.ok(1000 <= got);
    assert.ok(got <= 2000);
  });
  it("limited by retryMaxDelay", () => {
    // Calcurated range is 500-1000 but the larger end is limited to 600
    let got = r["getCurrentDelay"](0, 1000, 600);
    assert.ok(300 <= got);
    assert.ok(got <= 600);
  });
});
describe("HTTP Requestor", () => {
  const apikey = "apikey";
  const encodedKey = Buffer.from(apikey + ":").toString("base64");
  describe("buildHeader", () => {
    const payjp = new Payjp(apikey, {});

    it("GET", () => {
      let header = payjp.charges.buildHeader("GET");
      assert(header["Accept"] === "application/json");
      assert(header["Authorization"] === `Basic ${encodedKey}`);
      assert(header["Content-Type"] === undefined);
    });

    it("POST", () => {
      let header = payjp.charges.buildHeader("POST");
      assert(header["Accept"] === "application/json");
      assert(header["Authorization"] === `Basic ${encodedKey}`);
      assert(header["Content-Type"] === "application/x-www-form-urlencoded");
    });

    it("DELETE", () => {
      let header = payjp.charges.buildHeader("DELETE");
      assert(header["Accept"] === "application/json");
      assert(header["Authorization"] === `Basic ${encodedKey}`);
      assert(header["Content-Type"] === undefined);
    });
  });
  describe("request", () => {
    it("return 200 by POST with checking request headers", (done) => {
      const dummy = { amount: 50 };
      const status = 200;
      const server = http
        .createServer((msg, res) => {
          server.close();
          assert(!!msg.headers.host);
          assert.strictEqual(msg.headers["accept-encoding"], "gzip, deflate");
          assert.strictEqual(
            msg.headers["content-type"],
            "application/x-www-form-urlencoded"
          );
          assert(parseInt(msg.headers["content-length"], 10) > 0);
          assert.strictEqual(msg.headers.accept, "application/json");
          assert.strictEqual(msg.headers.authorization, "Basic " + encodedKey);
          assert.strictEqual(msg.headers.connection, "close");
          assert.strictEqual(msg.method, "POST");
          assert.strictEqual(msg.url, "/v1/charges");
          let rawData = "";
          msg.on("data", (chunk) => {
            rawData += chunk;
          });
          msg.on("end", () => {
            assert.strictEqual(rawData, "amount=50");
            const body = JSON.stringify(dummy);
            res.writeHead(status, {
              "Content-Length": Buffer.byteLength(body),
              "Content-Type": "application/json",
            });
            res.end(body);
          });
        })
        .listen(() => {
          const apibase = `http://localhost:${server.address().port}/v1`;
          const payjp = new Payjp(apikey, { apibase });
          payjp.charges.create(dummy).then((r) => {
            assert.deepStrictEqual(r, dummy);
            done();
          });
        });
    });
    it("return 400 by GET", (done) => {
      const dummy = { object: "payjp" };
      const status = 400;
      const server = http
        .createServer((msg, res) => {
          server.close();
          assert.strictEqual(msg.method, "GET");
          assert.strictEqual(msg.url, "/v1/charges?object=payjp");
          const body = JSON.stringify({
            error: {
              message: "test",
              status,
              type: "client_error",
            },
          });
          res.writeHead(status, {
            "Content-Length": Buffer.byteLength(body),
            "Content-Type": "application/json",
          });
          res.end(body);
        })
        .listen(() => {
          const apibase = `http://localhost:${server.address().port}/v1`;
          const payjp = new Payjp(apikey, { apibase });
          payjp.charges.list(dummy).catch((e) => {
            assert.strictEqual(e.status, status);
            assert.strictEqual(e.response.body.error.message, "test");
            assert.strictEqual(e.response.body.error.status, status);
            assert.strictEqual(e.response.body.error.type, "client_error");
            done();
          });
        });
    });
    it("return 200 by DELETE, but not json", (done) => {
      const status = 200;
      const server = http
        .createServer((msg, res) => {
          server.close();
          assert.strictEqual(msg.method, "DELETE");
          assert.strictEqual(msg.url, "/v1/plans/hoge");
          res.writeHead(status, { "Content-Type": "text/plain" });
          res.end("<html></html>");
        })
        .listen(() => {
          const apibase = `http://localhost:${server.address().port}/v1`;
          const payjp = new Payjp(apikey, { apibase });
          payjp.plans.delete("hoge").then((v) => {
            assert.deepStrictEqual(v, {});
            done();
          });
        });
    });
    it("return Network Error: request ok, but not response", (done) => {
      const server = http
        .createServer((msg, _) => {
          server.close();
          return msg.socket.destroy();
        })
        .listen(() => {
          const apibase = `http://localhost:${server.address().port}/v1`;
          const payjp = new Payjp(apikey, { apibase });
          payjp.charges.list().catch((r) => {
            assert.strictEqual(r.status, undefined);
            assert.strictEqual(r.response, undefined);
            assert.strictEqual(r.message, "socket hang up");
            done();
          });
        });
    });
    it("return Network Error: url not exists", (done) => {
      const server = http.createServer();
      server.listen(() => {
        const apibase = `http://localhost:${server.address().port}/v1`;
        server.close();
        const payjp = new Payjp(apikey, { apibase });
        payjp.charges.list().catch((r) => {
          assert.strictEqual(r.status, undefined);
          assert.strictEqual(r.response, undefined);
          assert.strictEqual(r.message.indexOf("connect ECONNREFUSED"), 0);
          done();
        });
      });
    });
    it("return timeout Error", (done) => {
      const server = http.createServer().listen(() => {
        const apibase = `http://localhost:${server.address().port}/v1`;
        const timeout = 50;
        const payjp = new Payjp(apikey, { apibase, timeout });
        payjp.charges.list().catch((r) => {
          server.close();
          assert.strictEqual(r.status, undefined);
          assert.strictEqual(r.response, undefined);
          assert.strictEqual(r.message, `Timeout of ${timeout}ms exceeded`);
          assert.strictEqual(r.timeout, timeout);
          done();
        });
      });
    });
    it("retries 429 error and success", (done) => {
      const statusCodes = [429, 429, 429, 200].entries();
      const server = createTestServer(statusCodes).listen(() => {
        const apibase = `http://localhost:${server.address().port}/v1`;
        const payjp = new Payjp(apikey, {
          apibase,
          maxRetry: 3,
          retryInitialDelay: 10,
        });
        payjp.charges
          .create()
          .then((charge) => {
            server.close();
            assert.strictEqual(charge.id, "ch_success");
            done();
          })
          .catch((e) => {
            server.close();
            done(e);
          });
      });
    });
    it("returns 429 after max retry", (done) => {
      const statusCodes = [429, 429, 429, 200].entries();
      const server = createTestServer(statusCodes).listen(() => {
        const apibase = `http://localhost:${server.address().port}/v1`;
        const payjp = new Payjp(apikey, {
          apibase,
          maxRetry: 2,
          retryInitialDelay: 10,
        });
        payjp.charges
          .create()
          .then((res) => {
            server.close();
            done(res);
          })
          .catch((e) => {
            server.close();
            assert.strictEqual(e.status, 429);
            done();
          });
      });
    });
    it("stops retrying when error response that not 429 has received", (done) => {
      const statusCodes = [429, 500, 429, 200].entries();
      const server = createTestServer(statusCodes).listen(() => {
        const apibase = `http://localhost:${server.address().port}/v1`;
        const payjp = new Payjp(apikey, {
          apibase,
          maxRetry: 3,
          retryInitialDelay: 10,
        });
        payjp.charges
          .create()
          .then((e) => {
            server.close();
            done(e);
          })
          .catch((e) => {
            server.close();
            assert.strictEqual(e.status, 500);
            done();
          });
      });
    });
  });
});
