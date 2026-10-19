"""GST invoice PDF (PY-11) and shipping label (AD-07).
Intra-state: CGST + SGST (half rate each); inter-state: IGST."""
import io
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A6
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import Order
from app.services.pricing import money

styles = getSampleStyleSheet()
small = styles["BodyText"].clone("small", fontSize=8, leading=10)
normal = styles["BodyText"].clone("n", fontSize=9, leading=12)
h1 = styles["Heading1"].clone("h", fontSize=15, leading=18, spaceAfter=2)


def _addr_lines(addr: dict | None) -> str:
    if not addr:
        return "Store pickup – Manali"
    parts = [addr.get("name"), addr.get("line1"), addr.get("line2"),
             f"{addr.get('city', '')}, {addr.get('state', '')} - {addr.get('pincode', '')}",
             f"Mobile: {addr.get('mobile', '')}"]
    return "<br/>".join(p for p in parts if p)


def _rs(v) -> str:
    return f"{Decimal(v):,.2f}"


def invoice_pdf(order: Order, store: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm, bottomMargin=12 * mm)
    el = []

    el.append(Paragraph(store.get("name") or "Great Foot Wear", h1))
    phones = ", ".join(store.get("phones") or [])
    el.append(Paragraph(f"{store.get('address', '')}<br/>Phone: {phones}"
                        + (f"<br/>Email: {store['email']}" if store.get("email") else "")
                        + f"<br/><b>GSTIN:</b> {store.get('gstin') or '—'}", normal))
    el.append(Spacer(1, 6))
    el.append(Paragraph("<b>TAX INVOICE</b>", styles["Heading3"]))

    supply_state = (order.address or {}).get("state") if order.fulfilment == "delivery" else store.get("state")
    meta = [
        [Paragraph(f"<b>Invoice No:</b> {order.invoice_no or '—'}", normal),
         Paragraph(f"<b>Order No:</b> {order.order_no}", normal)],
        [Paragraph(f"<b>Invoice Date:</b> {order.invoice_date.strftime('%d-%m-%Y') if order.invoice_date else '—'}", normal),
         Paragraph(f"<b>Order Date:</b> {order.created_at.strftime('%d-%m-%Y')}", normal)],
        [Paragraph(f"<b>Place of supply:</b> {supply_state or '—'}", normal),
         Paragraph(f"<b>Payment:</b> {'Cash on Delivery' if order.payment_method == 'cod' else 'Online (prepaid)'}", normal)],
    ]
    t = Table(meta, colWidths=[90 * mm, 90 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(t)
    el.append(Spacer(1, 6))

    bill = [[Paragraph("<b>Bill to / Ship to</b>", normal)],
            [Paragraph(f"{order.user.name}<br/>{_addr_lines(order.address)}", normal)]]
    bt = Table(bill, colWidths=[180 * mm])
    bt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke)]))
    el.append(bt)
    el.append(Spacer(1, 8))

    inter = order.is_inter_state
    head = ["#", "Item", "HSN", "Qty", "Rate", "Disc.", "Taxable", "GST %"]
    head += ["IGST"] if inter else ["CGST", "SGST"]
    head += ["Total"]
    rows = [head]
    tot_taxable = tot_tax = Decimal("0")
    for i, it in enumerate(order.items, 1):
        tax = Decimal(it.tax_amount)
        tot_taxable += Decimal(it.taxable_value)
        tot_tax += tax
        row = [
            str(i),
            Paragraph(f"{it.product_name}<br/><font size=7>Size {it.size} · {it.colour} · {it.sku}</font>", small),
            it.hsn_code or "",
            str(it.qty),
            _rs(it.price),
            _rs(it.discount),
            _rs(it.taxable_value),
            f"{Decimal(it.gst_rate):g}",
        ]
        if inter:
            row.append(_rs(tax))
        else:
            half = money(tax / 2)
            row += [_rs(half), _rs(tax - half)]
        row.append(_rs(it.line_total))
        rows.append(row)

    widths = [7, 55, 15, 9, 18, 14, 19, 11] + ([18] if inter else [15, 15]) + [19]
    it_table = Table(rows, colWidths=[w * mm for w in widths], repeatRows=1)
    it_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    el.append(it_table)
    el.append(Spacer(1, 8))

    summary = [
        ["Item total (incl. GST)", _rs(order.subtotal)],
        ["Coupon discount" + (f" ({order.coupon_code})" if order.coupon_code else ""), "-" + _rs(order.discount)],
        ["Taxable value", _rs(tot_taxable)],
    ]
    if inter:
        summary.append(["IGST", _rs(tot_tax)])
    else:
        half = money(tot_tax / 2)
        summary += [["CGST", _rs(half)], ["SGST", _rs(tot_tax - half)]]
    summary += [["Shipping charge", _rs(order.shipping)]]
    if Decimal(order.cod_fee) > 0:
        summary.append(["COD fee", _rs(order.cod_fee)])
    summary.append(["Grand total (Rs.)", _rs(order.total)])
    st = Table(summary, colWidths=[60 * mm, 30 * mm], hAlign="RIGHT")
    st.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.black),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    el.append(st)
    el.append(Spacer(1, 14))
    el.append(Paragraph("This is a computer generated invoice. Prices are inclusive of GST.", small))
    doc.build(el)
    return buf.getvalue()


def shipping_label_pdf(order: Order, store: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A6, leftMargin=6 * mm, rightMargin=6 * mm, topMargin=6 * mm, bottomMargin=6 * mm)
    el = [Paragraph(f"<b>Order:</b> {order.order_no}", normal)]
    if order.shipment and order.shipment.awb_no:
        el.append(Paragraph(f"<b>{order.shipment.courier or 'Courier'} AWB:</b> {order.shipment.awb_no}", normal))
    if order.payment_method == "cod":
        el.append(Paragraph(f"<b>COD – COLLECT Rs. {_rs(order.total)}</b>", styles["Heading3"]))
    else:
        el.append(Paragraph("<b>PREPAID</b>", styles["Heading3"]))
    el.append(Spacer(1, 4))
    el.append(Paragraph("<b>TO:</b><br/>" + _addr_lines(order.address), normal))
    el.append(Spacer(1, 6))
    phones = ", ".join(store.get("phones") or [])
    el.append(Paragraph(f"<b>FROM:</b><br/>{store.get('name')}<br/>{store.get('address')}<br/>Phone: {phones}", small))
    el.append(Spacer(1, 4))
    items = ", ".join(f"{i.product_name} ({i.size}/{i.colour}) x{i.qty}" for i in order.items)
    el.append(Paragraph(f"<b>Contents:</b> {items}", small))
    doc.build(el)
    return buf.getvalue()
