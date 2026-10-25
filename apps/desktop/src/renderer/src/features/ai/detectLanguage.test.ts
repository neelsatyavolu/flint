import { describe, expect, it } from "vitest";
import { detectLanguage } from "./detectLanguage";

const en = "Hi Sam, thanks for sending this over. Can you please confirm that the meeting is still on for Thursday? I will bring the notes from the last call and we can go through them together with the team.";
const es = "Hola Sam, gracias por enviar esto. ¿Puedes confirmar que la reunión sigue en pie para el jueves? Voy a traer las notas de la última llamada y las podemos revisar con el equipo, pero no tengo mucho tiempo.";
const fr = "Bonjour Sam, merci pour votre message. Pouvez-vous confirmer que la réunion est toujours prévue pour jeudi ? Je vais apporter les notes de la dernière réunion et nous pourrons les revoir avec toute l'équipe dans la salle.";
const de = "Hallo Sam, danke für die Nachricht. Kannst du bitte bestätigen, dass das Treffen am Donnerstag noch stattfindet? Ich bringe die Notizen von dem letzten Gespräch mit und wir gehen sie gemeinsam mit dem Team durch.";

describe("detectLanguage", () => {
  it("recognises common Latin-script languages", () => {
    expect(detectLanguage(en)).toBe("English");
    expect(detectLanguage(es)).toBe("Spanish");
    expect(detectLanguage(fr)).toBe("French");
    expect(detectLanguage(de)).toBe("German");
  });
  it("recognises other scripts", () => {
    expect(detectLanguage("こんにちは、会議は木曜日で大丈夫ですか。ノートを持っていきます。よろしくお願いします。")).toBe("Japanese");
    expect(detectLanguage("नमस्ते सैम, क्या गुरुवार की बैठक अभी भी तय है? मैं नोट्स लेकर आऊंगा।")).toBe("Hindi");
  });
  it("is silent on short or unclear text", () => {
    expect(detectLanguage("ok thanks")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("Invoice 2291 Quillworks Ltd 3 Oct 2026 PO 88213 total 1,240.00 USD net 30 terms apply to all open balances listed")).toBeNull();
  });
});
