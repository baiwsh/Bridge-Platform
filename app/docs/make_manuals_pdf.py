# -*- coding: utf-8 -*-
"""把 docs 下的 Markdown 手册渲染为排版精良的 PDF（ReportLab，中文三线表风格）"""
import os
import re
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Preformatted, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------- 中文字体 ----------
REGULAR = os.environ.get('DAIMON_CJK_FONT_REGULAR')
BOLD = os.environ.get('DAIMON_CJK_FONT_BOLD')
if not REGULAR or not BOLD:
    raise RuntimeError('缺少 Daimon 管理的 CJK 字体环境变量')
pdfmetrics.registerFont(TTFont('CJK', REGULAR))
pdfmetrics.registerFont(TTFont('CJK-B', BOLD))
pdfmetrics.registerFontFamily('CJK', normal='CJK', bold='CJK-B', italic='CJK', boldItalic='CJK-B')

# ---------- 配色（低饱和墨绿学术风） ----------
INK = HexColor('#333333')
GREEN = HexColor('#0b3d2e')
GRAY = HexColor('#666666')
LIGHT = HexColor('#f5f5f5')
RULE = HexColor('#0b3d2e')

S = {
    'title': ParagraphStyle('title', fontName='CJK-B', fontSize=24, leading=34, alignment=TA_CENTER, textColor=GREEN),
    'subtitle': ParagraphStyle('subtitle', fontName='CJK', fontSize=12, leading=20, alignment=TA_CENTER, textColor=GRAY),
    'h2': ParagraphStyle('h2', fontName='CJK-B', fontSize=15, leading=22, spaceBefore=16, spaceAfter=8, textColor=GREEN, keepWithNext=1),
    'h3': ParagraphStyle('h3', fontName='CJK-B', fontSize=12.5, leading=18, spaceBefore=10, spaceAfter=5, textColor=HexColor('#14532d'), keepWithNext=1),
    'body': ParagraphStyle('body', fontName='CJK', fontSize=10.5, leading=16.5, textColor=INK, spaceAfter=5),
    'quote': ParagraphStyle('quote', fontName='CJK', fontSize=9.5, leading=15, textColor=GRAY, leftIndent=14, spaceBefore=3, spaceAfter=6),
    'li': ParagraphStyle('li', fontName='CJK', fontSize=10.5, leading=16, textColor=INK, leftIndent=16, spaceAfter=3),
    'code': ParagraphStyle('code', fontName='CJK', fontSize=8, leading=11.5, backColor=LIGHT, leftIndent=4, rightIndent=4, spaceBefore=4, spaceAfter=8),
    'cell': ParagraphStyle('cell', fontName='CJK', fontSize=9, leading=13, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName='CJK-B', fontSize=9, leading=13, textColor=GREEN),
}

CONTENT_W = A4[0] - 5.5 * cm


def esc(t: str) -> str:
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def inline(t: str) -> str:
    """处理行内格式：**粗体**、`代码`、[文字](链接)"""
    t = esc(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`([^`]+)`', r'<font backColor="#eef2f0">\1</font>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1', t)
    return t


def make_table(rows: list[list[str]]) -> Table:
    ncol = max(len(r) for r in rows)
    rows = [r + [''] * (ncol - len(r)) for r in rows]
    data = []
    for i, r in enumerate(rows):
        st = 'cellb' if i == 0 else 'cell'
        data.append([Paragraph(inline(c), S[st]) for c in r])
    colw = [CONTENT_W / ncol] * ncol
    tbl = Table(data, colWidths=colw)
    tbl.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, 0), 1.2, RULE),
        ('LINEBELOW', (0, 0), (-1, 0), 0.6, RULE),
        ('LINEBELOW', (0, -1), (-1, -1), 1.2, RULE),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return tbl


def parse_md(text: str):
    """极简 Markdown 解析：返回 flowables（不含封面）"""
    lines = text.split('\n')
    story = []
    i = 0
    para: list[str] = []

    def flush_para():
        nonlocal para
        if para:
            story.append(Paragraph(inline(' '.join(x.strip() for x in para)), S['body']))
            para = []

    while i < len(lines):
        ln = lines[i].rstrip('\n')
        s = ln.strip()

        if s.startswith('```'):
            flush_para()
            i += 1
            code = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code.append(lines[i])
                i += 1
            i += 1
            story.append(Preformatted('\n'.join(code), S['code'], maxLineLength=110))
            continue

        if s.startswith('|'):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-{2,}:?', c) for c in row):
                    rows.append(row)
                i += 1
            if rows:
                story.append(Spacer(1, 4))
                story.append(make_table(rows))
                story.append(Spacer(1, 8))
            continue

        if not s:
            flush_para()
            i += 1
            continue

        if s.startswith('#### '):
            flush_para(); story.append(Paragraph(inline(s[5:]), S['h3'])); i += 1; continue
        if s.startswith('### '):
            flush_para(); story.append(Paragraph(inline(s[4:]), S['h3'])); i += 1; continue
        if s.startswith('## '):
            flush_para(); story.append(Paragraph(inline(s[3:]), S['h2'])); i += 1; continue
        if s.startswith('# '):
            i += 1; continue  # H1 走封面
        if s == '---':
            flush_para(); story.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#cccccc'), spaceBefore=6, spaceAfter=6)); i += 1; continue
        if s.startswith('> '):
            flush_para(); story.append(Paragraph(inline(s[2:]), S['quote'])); i += 1; continue
        m = re.match(r'^(-|\d+\.)\s+(.*)$', s)
        if m:
            flush_para()
            bullet = '•' if m.group(1) == '-' else m.group(1)
            story.append(Paragraph(f'{bullet} {inline(m.group(2))}', S['li']))
            i += 1; continue

        para.append(ln)
        i += 1

    flush_para()
    return story


def build(md_path: str, pdf_path: str, subtitle: str):
    text = open(md_path, encoding='utf-8').read()
    m = re.search(r'^#\s+(.+)$', text, re.M)
    title = m.group(1).strip() if m else os.path.basename(md_path)

    def cover(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(2)
        canvas.line(4 * cm, h - 6.2 * cm, w - 4 * cm, h - 6.2 * cm)
        canvas.setLineWidth(0.6)
        canvas.line(4 * cm, 5.2 * cm, w - 4 * cm, 5.2 * cm)
        canvas.restoreState()

    def later(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFont('CJK', 8.5)
        canvas.setFillColor(GRAY)
        canvas.drawCentredString(w / 2, h - 1.4 * cm, title)
        canvas.setStrokeColor(HexColor('#cccccc'))
        canvas.setLineWidth(0.4)
        canvas.line(3 * cm, h - 1.6 * cm, w - 2.5 * cm, h - 1.6 * cm)
        canvas.drawCentredString(w / 2, 1.3 * cm, f'第 {doc.page} 页')
        canvas.restoreState()

    doc = SimpleDocTemplate(pdf_path, pagesize=A4,
                            topMargin=2.4 * cm, bottomMargin=2.4 * cm,
                            leftMargin=3 * cm, rightMargin=2.5 * cm,
                            title=title, author='桥牌汇 BridgeHub', subject=subtitle)
    story = [
        Spacer(1, 4.2 * cm),
        Paragraph(title, S['title']),
        Spacer(1, 0.6 * cm),
        Paragraph(subtitle, S['subtitle']),
        Spacer(1, 0.4 * cm),
        Paragraph('桥牌汇 BridgeHub · 2026 年 10 月', S['subtitle']),
        PageBreak(),
    ]
    story.extend(parse_md(text))
    doc.build(story, onFirstPage=cover, onLaterPages=later)
    print('生成:', pdf_path)


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    build(os.path.join(here, '部署手册.md'), os.path.join(here, '部署手册.pdf'), '服务器部署 · 运维 · 故障排查')
    build(os.path.join(here, '用户使用手册.md'), os.path.join(here, '用户使用手册.pdf'), '注册 · 对战 · 每日双人赛 · 计分规则')
