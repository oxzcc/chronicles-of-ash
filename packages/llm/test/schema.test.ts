import { describe, expect, it } from "vitest";
import { getWorld } from "@ash/worlds";
import { partialSpeaker } from "../src/schema";

const R = getWorld("fantasy").rules;

describe("partialSpeaker", () => {
  it("ждёт, пока карточка дописана, и отдаёт её до конца ответа", () => {
    const head = '{"beats":[{"speaker":"Борн","text":"Чего надо?"}],"speaker":{"name":"Борн","race":"halforc","gender":"m","role":"трактирщик","look":"лысый';
    expect(partialSpeaker(head, R)).toBeUndefined();
    expect(partialSpeaker(head + ', фартук"}', R)).toBeUndefined();
    expect(partialSpeaker(head + ', фартук"},"changes":{"hp', R)).toMatchObject({ name: "Борн", race: "halforc" });
    expect(partialSpeaker('{"beats":[],"speaker":null,"changes":{', R)).toBeNull();
  });
});
