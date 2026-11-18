import { describe, expect, it } from "vitest";
import { partialSpeaker } from "../src/schema";

describe("partialSpeaker", () => {
  it("ждёт, пока карточка дописана, и отдаёт её до конца ответа", () => {
    const head = '{"beats":[{"speaker":"Борн","text":"Чего надо?"}],"speaker":{"name":"Борн","race":"halforc","gender":"m","role":"трактирщик","look":"лысый';
    expect(partialSpeaker(head)).toBeUndefined();
    expect(partialSpeaker(head + ', фартук"}')).toBeUndefined();
    expect(partialSpeaker(head + ', фартук"},"changes":{"hp')).toMatchObject({ name: "Борн", race: "halforc" });
    expect(partialSpeaker('{"beats":[],"speaker":null,"changes":{')).toBeNull();
  });
});
