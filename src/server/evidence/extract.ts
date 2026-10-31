/**
 * Text extraction. PDFs use pdf.js (via unpdf). Images have no OCR in this
 * MVP and return no text, which downstream code reports as unknown.
 */
export interface TextExtraction {
  pages: string[];
  pageCount: number | null;
  method: string;
}

export async function extractText(bytes: Uint8Array, mime: string): Promise<TextExtraction> {
  if (mime === "application/pdf") {
    const { getDocumentProxy, extractText: pdfText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await pdfText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map((p) => p.replace(/\r\n?/g, "\n"));
    return { pages, pageCount: totalPages, method: "pdfjs-text-layer" };
  }
  return { pages: [], pageCount: null, method: "none (image; OCR not configured)" };
}
