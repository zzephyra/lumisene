"""Bounded text-only parser; no OCR, macros, external XML entities or extraction to disk."""

import io
import xml.etree.ElementTree as ET
import zipfile

from app.core.errors import ValidationError
from app.infrastructure.parsing.documents import (
    DocumentFormat,
    ParsedDocument,
    ParserRegistry,
    resolve_document_format,
)

MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT = 200_000


def _parse(document_format: DocumentFormat, content: bytes) -> str:
    if not content or len(content) > MAX_BYTES:
        raise ValidationError("剧本不能为空且不能超过 5 MB")
    extension = {DocumentFormat.MARKDOWN: ".md"}.get(document_format, "." + document_format.value)
    try:
        if extension in {".txt", ".md"}:
            text = content.decode("utf-8-sig")
        elif extension == ".docx":
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if (
                    sum(i.file_size for i in archive.infolist()) > 20 * MAX_BYTES
                    or len(archive.infolist()) > 2000
                ):
                    raise ValidationError("文档解压大小超限")
                xml = archive.read("word/document.xml")
                if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
                    raise ValidationError("不支持包含实体声明的文档")
                root = ET.fromstring(xml)
                ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                text = "\n".join(
                    "".join(t.text or "" for t in p.iter(ns + "t")) for p in root.iter(ns + "p")
                )
        elif extension == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            if reader.is_encrypted or len(reader.pages) > 300:
                raise ValidationError("不支持加密或超过 300 页的 PDF")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        else:
            raise ValidationError("仅支持 TXT、Markdown、DOCX 和文字型 PDF")
    except (UnicodeError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValidationError("文件解析失败，请检查格式或使用 UTF-8 文本") from exc
    if not text.strip():
        raise ValidationError("未找到文字；扫描 PDF 暂不支持 OCR")
    if len(text) > MAX_TEXT or "\x00" in text:
        raise ValidationError("文本超过 20 万字或包含无效字符")
    return text


def split_text(text: str, size: int = 6000, overlap: int = 300) -> list[tuple[int, int, str]]:
    if not 0 <= overlap < size:
        raise ValueError("overlap must be smaller than size")
    result, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = text.rfind("\n", start + size // 2, end)
            if boundary > start:
                end = boundary + 1
        result.append((start, end, text[start:end]))
        if end == len(text):
            break
        start = end - overlap
    return result


class TextDocumentParser:
    def __init__(self, document_format: DocumentFormat):
        self.document_format = document_format

    def parse(self, content: bytes) -> ParsedDocument:
        return ParsedDocument(text=_parse(self.document_format, content))


registry = ParserRegistry()
for document_format in DocumentFormat:
    registry.register(TextDocumentParser(document_format))


def parse_document(filename: str, content: bytes) -> str:
    return registry.get(resolve_document_format(filename=filename)).parse(content).text
