/** Клиент S3: круговой прогон объекта и подписанной ссылки. */
import { describe, expect, test } from "vitest";

import { getStorage } from "../../lib/s3";
import { s3 } from "./support/s3";

const KEY = "u/test-user/s/test-session/uploads/0af1c2d3/sample.bin";
const PREFIX = "u/test-user/";

describe("клиент S3", () => {
  test("кладёт объект, читает его обратно и удаляет по префиксу", async () => {
    const storage = getStorage();
    const helper = s3();
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);

    await storage.putObject(KEY, bytes, "application/octet-stream");

    expect(await helper.exists(KEY)).toBe(true);
    expect(await helper.getBytes(KEY)).toEqual(bytes);
    expect(await helper.listKeys(PREFIX)).toContain(KEY);

    const removed = await storage.deletePrefix(PREFIX);

    expect(removed).toBeGreaterThan(0);
    expect(await helper.listKeys(PREFIX)).toEqual([]);
    expect(await storage.objectExists(KEY)).toBe(false);
  });

  test("подписанная ссылка на чтение отдаёт те же байты", async () => {
    const storage = getStorage();
    const bytes = new Uint8Array([7, 7, 7, 9]);

    await storage.putObject(KEY, bytes, "application/octet-stream");
    const url = await storage.presignRead(KEY, {
      expiresIn: 300,
      downloadName: "sample.bin",
    });

    const response = await fetch(url, { redirect: "manual" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("sample.bin");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    await storage.deletePrefix(PREFIX);
  });

  test("подписанная ссылка на загрузку принимает объект с указанным типом", async () => {
    const storage = getStorage();
    const bytes = new Uint8Array([4, 3, 2, 1]);

    const url = await storage.presignUpload(KEY, "application/octet-stream", { expiresIn: 300 });
    const upload = await fetch(url, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "application/octet-stream" },
      redirect: "manual",
    });

    expect(upload.status).toBe(200);
    expect(await storage.getObject(KEY)).toEqual(bytes);

    await storage.deletePrefix(PREFIX);
  });
});
