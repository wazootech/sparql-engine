export const foafName = "<http://xmlns.com/foaf/0.1/name>";
export const foafKnows = "<http://xmlns.com/foaf/0.1/knows>";
export const foafAge = "<http://xmlns.com/foaf/0.1/age>";
export const exampleAlice = "<http://example.org/ethan>";
export const exampleCarol = "<http://example.org/sandra>";
export const exampleNobody = "<http://example.org/nobody>";
export const exampleSelf = "<http://example.org/self>";
export const exampleDave = "http://example.org/dave";

export const path = (id: string) => `<http://example.org/${id}>`;
export const pPred = path("p");
export const qPred = path("q");

export const xsdDateTime = `<http://www.w3.org/2001/XMLSchema#dateTime>`;
export const dt = `"2011-01-10T14:45:13.815-05:00"^^${xsdDateTime}`;
