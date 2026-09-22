import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import QrIcon from '../components/QrIcon';
import { useCenters } from '../context/CentersContext';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import PhotoInput from '../components/PhotoInput';
import ProgramSelect, { resolveProgramName } from '../components/ProgramSelect';
import { formatInr } from '../utils/currency';

const EMPTY_LINE_ITEM = {
  classificationId: '',
  assetName: '',
  description: '',
  billQuantity: '',
  unit: 'pcs',
  unitPrice: '',
  gstPercent: 18,
  purchasedFor: '',
  // Asset tags are always generated. Manufacturer serials are opt-in, and QR
  // labels are opt-out (bulk consumables are never labelled one by one).
  recordSerials: false,
  serialNumbersText: '',
  printLabels: true,
  labelsTouched: false,
  image: '',
  hasWarranty: false,
  warrantyUntil: '',
};

const EMPTY_EDIT_NEW_LINE_ITEM = { ...EMPTY_LINE_ITEM };

// A line of this many units or more is almost always a reel or a bag, so the
// "print QR labels" box unticks itself until the admin says otherwise.
const BULK_QTY_THRESHOLD = 25;

function serialList(li) {
  return li.recordSerials ? (li.serialNumbersText || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean) : [];
}

// The quantity is the best signal for "bulk"; follow it until the admin has
// touched the labels box by hand.
function withLabelDefault(li, field, value) {
  const next = { ...li, [field]: value };
  if (field === 'billQuantity' && !li.labelsTouched) {
    next.printLabels = !(Number(value) >= BULK_QTY_THRESHOLD);
  }
  return next;
}

function calcLineItem(li) {
  const qty = Number(li.billQuantity) || 0;
  const price = Number(li.unitPrice) || 0;
  const gstPct = Number(li.gstPercent) || 0;
  const taxable = qty * price;
  const gst = taxable * (gstPct / 100);
  return { taxable, gst, total: taxable + gst };
}

export default function AdminInvoiceEntry() {
  const { centers } = useCenters();
  const { isMobile } = useViewport();
  const navigate = useNavigate();
  // Units created by the invoice just saved -- offered for label printing
  // right away, so new stock gets tagged before it goes on the shelf.
  const [justCreated, setJustCreated] = useState(null); // { invoiceId, invoiceNumber, count }
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  const [centerId, setCenterId] = useState('');
  const [lookups, setLookups] = useState({ classifications: [], vendors: [], businessHeads: [], projects: [] });
  const [catalogItems, setCatalogItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Shared by every line item's PhotoInput (new-invoice form and edit form)
  // -- blocks Save while any photo upload (POST /api/assets/upload-image)
  // is still in flight, so a submit can't go out with a stale image value.
  const [photoUploading, setPhotoUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  const [invoiceDocuments, setInvoiceDocuments] = useState([]);
  const [docUploading, setDocUploading] = useState(false);
  const [docMsg, setDocMsg] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceClassFilter, setInvoiceClassFilter] = useState('All');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [header, setHeader] = useState({
    vendorName: '', invoiceNumber: '', invoiceDate: '', projectName: '', businessHeadName: '',
    installationCharges: '', freightCharges: '',
  });
  const [otherProjectName, setOtherProjectName] = useState('');
  const [otherEditProjectName, setOtherEditProjectName] = useState('');
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE_ITEM }]);

  // Depends on `centers` because the list is fetched: on first render it is
  // still empty, so a super admin would otherwise be left with no center
  // selected until they picked one by hand.
  useEffect(() => {
    setCenterId(isSuperAdmin ? (centers[0]?.id || '') : (user?.centerId || ''));
  }, [isSuperAdmin, user, centers]);

  useEffect(() => {
    if (!centerId) return;
    fetchLookups();
    fetchInvoices();
    fetchCatalogItems();
  }, [centerId]);

  async function fetchLookups() {
    try {
      const { data } = await axios.get('/api/invoices/lookups', { params: { centerId } });
      setLookups(data);
    } catch (err) {
      setMsgType('error');
      setMsg(err.response?.data?.message || 'Unable to load form options.');
    }
  }

  async function fetchCatalogItems() {
    try {
      const { data } = await axios.get('/api/assets/catalog-summary', { params: { centerId } });
      setCatalogItems(data);
    } catch {
      // Non-critical: the form still works without name suggestions/stock hints.
    }
  }

  function findCatalogMatch(name) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return null;
    return catalogItems.find(c => c.name.trim().toLowerCase() === normalized) || null;
  }

  async function fetchInvoices() {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/invoices', { params: { centerId } });
      setInvoices(data);
    } catch (err) {
      setMsgType('error');
      setMsg(err.response?.data?.message || 'Unable to load invoices.');
    } finally {
      setLoading(false);
    }
  }

  function updateLineItem(index, field, value) {
    setLineItems(items => items.map((li, i) => (i === index ? withLabelDefault(li, field, value) : li)));
  }

  function addLineItem() {
    setLineItems(items => [...items, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLineItem(index) {
    setLineItems(items => items.length > 1 ? items.filter((_, i) => i !== index) : items);
  }

  const totals = lineItems.reduce((acc, li) => {
    const { taxable, gst } = calcLineItem(li);
    return { taxable: acc.taxable + taxable, gst: acc.gst + gst };
  }, { taxable: 0, gst: 0 });
  const installation = Number(header.installationCharges) || 0;
  const freight = Number(header.freightCharges) || 0;
  const grandTotal = totals.taxable + totals.gst + installation + freight;

  async function handleSubmit(event) {
    event.preventDefault();
    setMsg('');

    const payload = {
      centerId,
      ...header,
      projectName: resolveProgramName(header.projectName, otherProjectName),
      installationCharges: Number(header.installationCharges) || 0,
      freightCharges: Number(header.freightCharges) || 0,
      lineItems: lineItems.map(li => ({
        classificationId: Number(li.classificationId),
        assetName: li.assetName.trim(),
        description: li.description.trim(),
        billQuantity: Number(li.billQuantity),
        unit: li.unit || 'pcs',
        unitPrice: Number(li.unitPrice),
        gstPercent: Number(li.gstPercent) || 0,
        purchasedFor: li.purchasedFor.trim(),
        isBulk: !li.recordSerials,
        serialNumbers: serialList(li),
        printLabels: li.printLabels !== false,
        image: li.image.trim(),
        hasWarranty: li.hasWarranty,
        warrantyUntil: li.hasWarranty ? li.warrantyUntil : '',
      })),
    };

    setSaving(true);
    try {
      const { data: saved } = await axios.post('/api/invoices', payload);
      const unitCount = (saved.lineItems || []).reduce((n, li) => n + (li.assets || []).length, 0);
      const labelCount = (saved.lineItems || []).reduce((n, li) => n + (li.assets || []).filter(a => a.needsLabel !== false).length, 0);
      setJustCreated({ invoiceId: saved.id, invoiceNumber: saved.invoiceNumber, count: labelCount });
      setMsgType('success');
      setMsg(`Invoice ${saved.invoiceNumber} recorded: ${unitCount} unit${unitCount === 1 ? '' : 's'} added with asset tags`
        + (labelCount < unitCount ? ` (${unitCount - labelCount} bulk, no labels).` : '.'));
      setHeader({ vendorName: '', invoiceNumber: '', invoiceDate: '', projectName: '', businessHeadName: '', installationCharges: '', freightCharges: '' });
      setOtherProjectName('');
      setLineItems([{ ...EMPTY_LINE_ITEM }]);
      setFormOpen(false);
      fetchInvoices();
      fetchLookups();
      fetchCatalogItems();
    } catch (err) {
      setMsgType('error');
      setMsg(err.response?.data?.message || 'Unable to save invoice.');
    } finally {
      setSaving(false);
    }
  }

  async function openInvoiceDetail(invoiceId) {
    setInvoiceDetailLoading(true);
    setSelectedInvoice({ loading: true });
    setEditMode(false);
    setEditMsg('');
    setDocMsg('');
    setInvoiceDocuments([]);
    try {
      const { data } = await axios.get(`/api/invoices/${invoiceId}`);
      setSelectedInvoice(data);
      fetchInvoiceDocuments(invoiceId);
    } catch (err) {
      setSelectedInvoice(null);
      setMsgType('error');
      setMsg(err.response?.data?.message || 'Unable to load invoice details.');
    } finally {
      setInvoiceDetailLoading(false);
    }
  }

  async function fetchInvoiceDocuments(invoiceId) {
    try {
      const { data } = await axios.get(`/api/invoices/${invoiceId}/documents`);
      setInvoiceDocuments(data);
    } catch {
      // detail view still usable without the document list
    }
  }

  async function handleUploadDocuments(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setDocMsg('');
    setDocUploading(true);
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      await axios.post(`/api/invoices/${selectedInvoice.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await fetchInvoiceDocuments(selectedInvoice.id);
    } catch (err) {
      setDocMsg(err.response?.data?.message || 'Unable to upload document(s).');
    } finally {
      setDocUploading(false);
    }
  }

  async function handleDeleteDocument(docId) {
    if (!window.confirm('Delete this attached document? This cannot be undone.')) return;
    setDocMsg('');
    try {
      await axios.delete(`/api/invoices/${selectedInvoice.id}/documents/${docId}`);
      await fetchInvoiceDocuments(selectedInvoice.id);
    } catch (err) {
      setDocMsg(err.response?.data?.message || 'Unable to delete this document.');
    }
  }

  async function handleViewDocument(doc) {
    setDocMsg('');
    try {
      const response = await axios.get(`/api/invoices/${selectedInvoice.id}/documents/${doc.id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: doc.mime_type }));
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setDocMsg(err.response?.data?.message || 'Unable to open this document.');
    }
  }

  async function downloadInvoicePdf(invoiceId, invoiceNumber) {
    setDownloadingPdf(true);
    try {
      const response = await axios.get(`/api/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setMsgType('error');
      setMsg('Unable to download the invoice PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  }

  const invoiceClassifications = ['All', ...Array.from(new Set(
    invoices.flatMap(inv => (inv.classifications || '').split(',').map(s => s.trim()).filter(Boolean))
  )).sort((a, b) => a.localeCompare(b))];

  const filteredInvoices = invoices.filter(inv => {
    if (invoiceClassFilter !== 'All' && !(inv.classifications || '').split(',').map(s => s.trim()).includes(invoiceClassFilter)) {
      return false;
    }
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return true;
    return [inv.invoice_number, inv.vendor_name, inv.project_name].some(v => (v || '').toLowerCase().includes(q));
  });

  function startEdit() {
    setEditForm({
      vendorName: selectedInvoice.vendor_name || '',
      invoiceDate: selectedInvoice.invoice_date ? selectedInvoice.invoice_date.slice(0, 10) : '',
      projectName: selectedInvoice.project_name || '',
      businessHeadName: selectedInvoice.business_head_name || '',
      installationCharges: selectedInvoice.installation_charges || 0,
      freightCharges: selectedInvoice.freight_charges || 0,
      lineItems: selectedInvoice.lineItems.map(li => ({
        isExisting: true, id: li.id, assetName: li.asset_name, billQuantity: li.bill_quantity,
        unitPrice: li.unit_price ?? '', gstPercent: li.gst_percent, purchasedFor: li.purchased_for || '',
        description: li.description || '', image: li.image || '',
        recordSerials: false, serialNumbersText: '', printLabels: undefined, labelsTouched: false,
        hasWarranty: !!li.has_warranty, warrantyUntil: li.warranty_until || '',
      })),
    });
    setOtherEditProjectName('');
    setEditMsg('');
    setEditMode(true);
  }

  function updateEditLineItem(index, field, value) {
    setEditForm(f => ({ ...f, lineItems: f.lineItems.map((li, i) => (i === index ? withLabelDefault(li, field, value) : li)) }));
  }

  function addEditLineItem() {
    setEditForm(f => ({ ...f, lineItems: [...f.lineItems, { isExisting: false, ...EMPTY_EDIT_NEW_LINE_ITEM }] }));
  }

  function removeEditLineItem(index) {
    setEditForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== index) }));
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    setEditMsg('');
    setEditSaving(true);
    try {
      const { data } = await axios.put(`/api/invoices/${selectedInvoice.id}`, {
        vendorName: editForm.vendorName, invoiceDate: editForm.invoiceDate,
        projectName: resolveProgramName(editForm.projectName, otherEditProjectName),
        businessHeadName: editForm.businessHeadName,
        installationCharges: Number(editForm.installationCharges) || 0,
        freightCharges: Number(editForm.freightCharges) || 0,
        lineItems: editForm.lineItems.map(li => (li.isExisting ? {
          id: li.id, billQuantity: Number(li.billQuantity), unitPrice: Number(li.unitPrice),
          gstPercent: Number(li.gstPercent) || 0, purchasedFor: li.purchasedFor,
          description: li.description, image: li.image,
          isBulk: !li.recordSerials, serialNumbers: serialList(li),
          // Only sent once the admin has touched the box; otherwise new units
          // follow the line item's existing ones.
          ...(li.labelsTouched ? { printLabels: li.printLabels !== false } : {}),
          hasWarranty: li.hasWarranty, warrantyUntil: li.hasWarranty ? li.warrantyUntil : '',
        } : {
          classificationId: Number(li.classificationId), assetName: li.assetName.trim(), description: li.description.trim(),
          billQuantity: Number(li.billQuantity), unit: li.unit || 'pcs', unitPrice: Number(li.unitPrice),
          gstPercent: Number(li.gstPercent) || 0, purchasedFor: li.purchasedFor.trim(),
          isBulk: !li.recordSerials, serialNumbers: serialList(li),
          printLabels: li.printLabels !== false,
          image: li.image.trim(),
          hasWarranty: li.hasWarranty, warrantyUntil: li.hasWarranty ? li.warrantyUntil : '',
        })),
      });
      setSelectedInvoice(data);
      setEditMode(false);
      fetchInvoices();
      fetchCatalogItems();
    } catch (err) {
      setEditMsg(err.response?.data?.message || 'Unable to save changes.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteInvoice() {
    if (!window.confirm(`Delete invoice ${selectedInvoice.invoice_number}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/invoices/${selectedInvoice.id}`);
      setSelectedInvoice(null);
      fetchInvoices();
      fetchCatalogItems();
    } catch (err) {
      setEditMsg(err.response?.data?.message || 'Unable to delete this invoice.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Invoice Entry</h1>
            <p style={styles.sub}>Record a Tax Invoice as the master record for new inventory — every asset created here gets a unique ID and links back to this invoice.</p>
          </div>
          {!formOpen && isSuperAdmin && (
            <button type="button" style={styles.newInvoiceBtn} onClick={() => setFormOpen(true)}>+ New Invoice</button>
          )}
        </div>

        {isSuperAdmin && (
          <div style={styles.centerRow}>
            <select value={centerId} onChange={event => setCenterId(event.target.value)} style={styles.centerSelect}>
              {centers.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
          </div>
        )}

        {msg && (
          <div style={{ ...styles.pageMsg, ...(msgType === 'error' ? styles.pageMsgError : styles.pageMsgSuccess) }}>
            <span>{msg}</span>
            {msgType === 'success' && justCreated && justCreated.count > 0 && (
              <button
                type="button"
                style={styles.printNowBtn}
                onClick={() => navigate(`/admin/labels?invoiceId=${justCreated.invoiceId}&centerId=${encodeURIComponent(centerId)}`)}
              >
                <QrIcon size={15} /> Print {justCreated.count} QR label{justCreated.count === 1 ? '' : 's'} now
              </button>
            )}
          </div>
        )}

        {formOpen && (
        <form onSubmit={handleSubmit} style={styles.card}>
          <h2 style={styles.sectionTitle}>Invoice Details</h2>
          <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
            <Field label="Vendor / Party Name *">
              <input style={styles.input} list="vendor-list" value={header.vendorName} required
                onChange={e => setHeader({ ...header, vendorName: e.target.value })} />
              <datalist id="vendor-list">
                {lookups.vendors.map(v => <option key={v.id} value={v.name} />)}
              </datalist>
            </Field>
            <Field label="Invoice Number *">
              <input style={styles.input} value={header.invoiceNumber} required
                onChange={e => setHeader({ ...header, invoiceNumber: e.target.value })} />
            </Field>
            <Field label="Invoice Date *">
              <input type="date" style={styles.input} value={header.invoiceDate} required
                onChange={e => setHeader({ ...header, invoiceDate: e.target.value })} />
            </Field>
            <ProgramSelect
              programs={lookups.projects} mode="name" label="Program Name" required
              value={header.projectName} otherValue={otherProjectName}
              onChange={value => setHeader({ ...header, projectName: value })}
              onOtherChange={setOtherProjectName}
            />
            <Field label="Business Head / Department *">
              <select style={styles.input} value={header.businessHeadName} required
                onChange={e => setHeader({ ...header, businessHeadName: e.target.value })}>
                <option value="">Select...</option>
                {lookups.businessHeads.filter(b => b.name !== 'Unspecified').map(b => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Installation Charges">
              <input type="number" min="0" step="0.01" style={styles.input} value={header.installationCharges}
                onChange={e => setHeader({ ...header, installationCharges: e.target.value })} />
            </Field>
            <Field label="Freight Charges">
              <input type="number" min="0" step="0.01" style={styles.input} value={header.freightCharges}
                onChange={e => setHeader({ ...header, freightCharges: e.target.value })} />
            </Field>
          </div>

          <h2 style={styles.sectionTitle}>Line Items</h2>
          <datalist id="catalog-name-list">
            {catalogItems.map(c => <option key={c.catalog_id} value={c.name} />)}
          </datalist>
          {lineItems.map((li, index) => {
            const calc = calcLineItem(li);
            return (
              <div key={index} style={styles.lineItemCard}>
                <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
                  <Field label="Classification *">
                    <select style={styles.input} value={li.classificationId} required
                      onChange={e => updateLineItem(index, 'classificationId', e.target.value)}>
                      <option value="">Select...</option>
                      {lookups.classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Asset Name *">
                    <input style={styles.input} value={li.assetName} required list="catalog-name-list"
                      placeholder="Start typing to see existing components..."
                      onChange={e => updateLineItem(index, 'assetName', e.target.value)} />
                    {(() => {
                      const match = findCatalogMatch(li.assetName);
                      return match ? (
                        <span style={styles.stockHint}>Existing component &middot; {match.available} available / {match.total} total in stock</span>
                      ) : li.assetName.trim() ? (
                        <span style={styles.stockHintNew}>New component &middot; will be added to the catalog</span>
                      ) : null;
                    })()}
                  </Field>
                  <Field label="Description (shown to students browsing this component)">
                    <textarea style={{ ...styles.input, height: '52px' }} value={li.description}
                      placeholder="What is this component, what's it used for..."
                      onChange={e => updateLineItem(index, 'description', e.target.value)} />
                  </Field>
                  <Field label="Bill Quantity *">
                    <input type="number" min="1" style={styles.input} value={li.billQuantity} required
                      onChange={e => updateLineItem(index, 'billQuantity', e.target.value)} />
                  </Field>
                  <Field label="Unit">
                    <input style={styles.input} value={li.unit} onChange={e => updateLineItem(index, 'unit', e.target.value)} />
                  </Field>
                  <Field label="Unit Price *">
                    <input type="number" min="0" step="0.01" style={styles.input} value={li.unitPrice} required
                      onChange={e => updateLineItem(index, 'unitPrice', e.target.value)} />
                  </Field>
                  <Field label="GST %">
                    <input type="number" min="0" step="0.01" style={styles.input} value={li.gstPercent}
                      onChange={e => updateLineItem(index, 'gstPercent', e.target.value)} />
                  </Field>
                  <Field label="Purchased For">
                    <input style={styles.input} value={li.purchasedFor} onChange={e => updateLineItem(index, 'purchasedFor', e.target.value)} />
                  </Field>
<Field label="Unit tracking">
                    <label style={styles.bulkCheckboxRow}>
                      <input type="checkbox" checked={li.printLabels !== false}
                        onChange={e => { updateLineItem(index, 'printLabels', e.target.checked); updateLineItem(index, 'labelsTouched', true); }} />
                      <span>Print QR labels for these units</span>
                    </label>
                    <div style={styles.fieldHint}>
                      Untick for bulk consumables (resistors, jumper wires, screws) that are never labelled one by one.
                      Switches off by itself for quantities of {BULK_QTY_THRESHOLD} or more; change it as needed.
                    </div>
                    <label style={{ ...styles.bulkCheckboxRow, marginTop: '8px' }}>
                      <input type="checkbox" checked={!!li.recordSerials}
                        onChange={e => updateLineItem(index, 'recordSerials', e.target.checked)} />
                      <span>Record manufacturer serial numbers (optional)</span>
                    </label>
                    {li.recordSerials && (
                      <textarea style={{ ...styles.input, height: '52px', marginTop: '6px' }} value={li.serialNumbersText}
                        placeholder="One per unit, in order -- comma or newline separated. Missing ones are left blank."
                        onChange={e => updateLineItem(index, 'serialNumbersText', e.target.value)} />
                    )}
                  </Field>
                  <Field label="Warranty">
                    <label style={styles.bulkCheckboxRow}>
                      <input type="checkbox" checked={li.hasWarranty}
                        onChange={e => updateLineItem(index, 'hasWarranty', e.target.checked)} />
                      <span>This batch has a warranty</span>
                    </label>
                    {li.hasWarranty && (
                      <input type="date" style={styles.input} value={li.warrantyUntil} required
                        onChange={e => updateLineItem(index, 'warrantyUntil', e.target.value)} />
                    )}
                  </Field>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <PhotoInput label="Photo (optional)" name={li.assetName} value={li.image} onChange={value => updateLineItem(index, 'image', value)} onUploadStateChange={setPhotoUploading} />
                  </div>
                </div>
                <div style={styles.lineItemFooter}>
                  <span style={styles.lineItemCalc}>
                    Taxable {formatInr(calc.taxable)} · GST {formatInr(calc.gst)} · Line Total {formatInr(calc.total)}
                  </span>
                  {lineItems.length > 1 && (
                    <button type="button" style={styles.removeBtn} onClick={() => removeLineItem(index)}>Remove</button>
                  )}
                </div>
              </div>
            );
          })}
          <button type="button" style={styles.addLineBtn} onClick={addLineItem}>+ Add Line Item</button>

          <div style={styles.totalsBox}>
            <div>Taxable Value: <strong>{formatInr(totals.taxable)}</strong></div>
            <div>GST Value: <strong>{formatInr(totals.gst)}</strong></div>
            <div>Installation + Freight: <strong>{formatInr(installation + freight)}</strong></div>
            <div style={styles.grandTotal}>Total Bill Value: <strong>{formatInr(grandTotal)}</strong></div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" style={styles.removeBtn} onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" style={{ ...styles.submitBtn, flex: 1 }} disabled={saving || photoUploading}>
              {saving ? 'Saving...' : photoUploading ? 'Uploading photo...' : 'Save Invoice & Generate Assets'}
            </button>
          </div>
        </form>
        )}

        <h2 style={styles.sectionTitle}>Recent Invoices</h2>
        <div style={{ ...styles.grid, gridTemplateColumns: '1fr 240px', ...(isMobile ? styles.gridMobile : {}), marginBottom: '14px' }}>
          <input style={styles.input} placeholder="Search invoice #, vendor, project..."
            value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} />
          <select style={styles.input} value={invoiceClassFilter} onChange={e => setInvoiceClassFilter(e.target.value)}>
            {invoiceClassifications.map(c => <option key={c} value={c}>{c === 'All' ? 'All Classifications' : c}</option>)}
          </select>
        </div>
        {loading ? (
          <div style={styles.loading}>Loading...</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead style={styles.thead}>
                <tr>
                  <th style={styles.th}>Invoice #</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Vendor</th>
                  <th style={styles.th}>Program</th>
                  <th style={styles.th}>Line Items</th>
                  <th style={styles.th}>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 && (
                  <tr><td style={styles.emptyRow} colSpan={6}>No invoices found.</td></tr>
                )}
                {filteredInvoices.map(inv => (
                  <tr key={inv.id} style={styles.trClickable} onClick={() => openInvoiceDetail(inv.id)}>
                    <td style={styles.td}>{inv.invoice_number}</td>
                    <td style={styles.td}>{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '-'}</td>
                    <td style={styles.td}>{inv.vendor_name}</td>
                    <td style={styles.td}>{inv.project_name}</td>
                    <td style={styles.td}>{inv.line_item_count}</td>
                    <td style={styles.td}>{formatInr(inv.total_bill_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {selectedInvoice && (
        <div style={styles.modalOverlay} onClick={() => { setSelectedInvoice(null); setEditMode(false); }}>
          <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
            {invoiceDetailLoading || !selectedInvoice.invoice_number ? (
              <div style={styles.loading}>Loading invoice...</div>
            ) : editMode ? (
              <form onSubmit={handleEditSubmit}>
                <div style={styles.modalHeader}>
                  <h2 style={styles.sectionTitle}>Edit Invoice {selectedInvoice.invoice_number}</h2>
                  <button type="button" style={styles.closeBtn} onClick={() => setEditMode(false)}>&times;</button>
                </div>
                {editMsg && <div style={{ ...styles.pageMsg, ...styles.pageMsgError }}>{editMsg}</div>}
                <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
                  <Field label="Vendor / Party Name">
                    <input style={styles.input} value={editForm.vendorName} onChange={e => setEditForm({ ...editForm, vendorName: e.target.value })} />
                  </Field>
                  <Field label="Invoice Date">
                    <input type="date" style={styles.input} value={editForm.invoiceDate} onChange={e => setEditForm({ ...editForm, invoiceDate: e.target.value })} />
                  </Field>
                  <ProgramSelect
                    programs={lookups.projects} mode="name" label="Program Name"
                    value={editForm.projectName} otherValue={otherEditProjectName}
                    onChange={value => setEditForm({ ...editForm, projectName: value })}
                    onOtherChange={setOtherEditProjectName}
                  />
                  <Field label="Business Head / Department">
                    <select style={styles.input} value={editForm.businessHeadName} onChange={e => setEditForm({ ...editForm, businessHeadName: e.target.value })}>
                      {lookups.businessHeads.filter(b => b.name !== 'Unspecified').map(b => (
                        <option key={b.id} value={b.name}>{b.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Installation Charges">
                    <input type="number" min="0" step="0.01" style={styles.input} value={editForm.installationCharges}
                      onChange={e => setEditForm({ ...editForm, installationCharges: e.target.value })} />
                  </Field>
                  <Field label="Freight Charges">
                    <input type="number" min="0" step="0.01" style={styles.input} value={editForm.freightCharges}
                      onChange={e => setEditForm({ ...editForm, freightCharges: e.target.value })} />
                  </Field>
                </div>

                <h2 style={styles.sectionTitle}>Line Items</h2>
                <datalist id="catalog-name-list-edit">
                  {catalogItems.map(c => <option key={c.catalog_id} value={c.name} />)}
                </datalist>
                {editForm.lineItems.map((li, index) => (
                  <div key={index} style={styles.lineItemCard}>
                    {li.isExisting ? (
                      <>
                        <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
                          <Field label="Item"><div style={styles.readonlyText}>{li.assetName}</div></Field>
                          <Field label="Bill Quantity">
                            <input type="number" min="0" style={styles.input} value={li.billQuantity}
                              onChange={e => updateEditLineItem(index, 'billQuantity', e.target.value)} />
                          </Field>
                          <Field label="Unit Price">
                            <input type="number" min="0" step="0.01" style={styles.input} value={li.unitPrice}
                              onChange={e => updateEditLineItem(index, 'unitPrice', e.target.value)} />
                          </Field>
                          <Field label="GST %">
                            <input type="number" min="0" step="0.01" style={styles.input} value={li.gstPercent}
                              onChange={e => updateEditLineItem(index, 'gstPercent', e.target.value)} />
                          </Field>
                          <Field label="Purchased For">
                            <input style={styles.input} value={li.purchasedFor}
                              onChange={e => updateEditLineItem(index, 'purchasedFor', e.target.value)} />
                          </Field>
                          <Field label="Description (shown to students)">
                            <textarea style={{ ...styles.input, height: '42px' }} value={li.description}
                              onChange={e => updateEditLineItem(index, 'description', e.target.value)} />
                          </Field>
<Field label="Unit tracking for NEW units added by a quantity increase">
                    <label style={styles.bulkCheckboxRow}>
                      <input type="checkbox" checked={li.printLabels !== false}
                        onChange={e => { updateEditLineItem(index, 'printLabels', e.target.checked); updateEditLineItem(index, 'labelsTouched', true); }} />
                      <span>Print QR labels for these units</span>
                    </label>
                    <div style={styles.fieldHint}>
                      Untick for bulk consumables (resistors, jumper wires, screws) that are never labelled one by one.
                      Switches off by itself for quantities of {BULK_QTY_THRESHOLD} or more; change it as needed.
                    </div>
                    <label style={{ ...styles.bulkCheckboxRow, marginTop: '8px' }}>
                      <input type="checkbox" checked={!!li.recordSerials}
                        onChange={e => updateEditLineItem(index, 'recordSerials', e.target.checked)} />
                      <span>Record manufacturer serial numbers (optional)</span>
                    </label>
                    {li.recordSerials && (
                      <textarea style={{ ...styles.input, height: '52px', marginTop: '6px' }} value={li.serialNumbersText}
                        placeholder="One per unit, in order -- comma or newline separated. Missing ones are left blank."
                        onChange={e => updateEditLineItem(index, 'serialNumbersText', e.target.value)} />
                    )}
                  </Field>
                          <Field label="Warranty (applies to this batch's units)">
                            <label style={styles.bulkCheckboxRow}>
                              <input type="checkbox" checked={li.hasWarranty}
                                onChange={e => updateEditLineItem(index, 'hasWarranty', e.target.checked)} />
                              <span>This batch has a warranty</span>
                            </label>
                            {li.hasWarranty && (
                              <input type="date" style={styles.input} value={li.warrantyUntil} required
                                onChange={e => updateEditLineItem(index, 'warrantyUntil', e.target.value)} />
                            )}
                          </Field>
                        </div>
                        <p style={styles.editHint}>
                          Reducing quantity only removes units still marked "available" — anything already issued, damaged, or otherwise moved is left untouched.
                          This does not edit serial numbers on already-existing units — to correct one, go to Inventory → View Units → Edit on that specific unit.
                        </p>
                      </>
                    ) : (
                      <>
                        <div style={styles.newLineTag}>New line item</div>
                        <div style={{ ...styles.grid, ...(isMobile ? styles.gridMobile : {}) }}>
                          <Field label="Classification *">
                            <select style={styles.input} value={li.classificationId} required
                              onChange={e => updateEditLineItem(index, 'classificationId', e.target.value)}>
                              <option value="">Select...</option>
                              {lookups.classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </Field>
                          <Field label="Asset Name *">
                            <input style={styles.input} list="catalog-name-list-edit" value={li.assetName} required
                              onChange={e => updateEditLineItem(index, 'assetName', e.target.value)} />
                          </Field>
                          <Field label="Description (shown to students)">
                            <textarea style={{ ...styles.input, height: '42px' }} value={li.description}
                              onChange={e => updateEditLineItem(index, 'description', e.target.value)} />
                          </Field>
                          <Field label="Bill Quantity *">
                            <input type="number" min="1" style={styles.input} value={li.billQuantity} required
                              onChange={e => updateEditLineItem(index, 'billQuantity', e.target.value)} />
                          </Field>
                          <Field label="Unit">
                            <input style={styles.input} value={li.unit} onChange={e => updateEditLineItem(index, 'unit', e.target.value)} />
                          </Field>
                          <Field label="Unit Price *">
                            <input type="number" min="0" step="0.01" style={styles.input} value={li.unitPrice} required
                              onChange={e => updateEditLineItem(index, 'unitPrice', e.target.value)} />
                          </Field>
                          <Field label="GST %">
                            <input type="number" min="0" step="0.01" style={styles.input} value={li.gstPercent}
                              onChange={e => updateEditLineItem(index, 'gstPercent', e.target.value)} />
                          </Field>
                          <Field label="Purchased For">
                            <input style={styles.input} value={li.purchasedFor} onChange={e => updateEditLineItem(index, 'purchasedFor', e.target.value)} />
                          </Field>
<Field label="Unit tracking">
                    <label style={styles.bulkCheckboxRow}>
                      <input type="checkbox" checked={li.printLabels !== false}
                        onChange={e => { updateEditLineItem(index, 'printLabels', e.target.checked); updateEditLineItem(index, 'labelsTouched', true); }} />
                      <span>Print QR labels for these units</span>
                    </label>
                    <div style={styles.fieldHint}>
                      Untick for bulk consumables (resistors, jumper wires, screws) that are never labelled one by one.
                      Switches off by itself for quantities of {BULK_QTY_THRESHOLD} or more; change it as needed.
                    </div>
                    <label style={{ ...styles.bulkCheckboxRow, marginTop: '8px' }}>
                      <input type="checkbox" checked={!!li.recordSerials}
                        onChange={e => updateEditLineItem(index, 'recordSerials', e.target.checked)} />
                      <span>Record manufacturer serial numbers (optional)</span>
                    </label>
                    {li.recordSerials && (
                      <textarea style={{ ...styles.input, height: '52px', marginTop: '6px' }} value={li.serialNumbersText}
                        placeholder="One per unit, in order -- comma or newline separated. Missing ones are left blank."
                        onChange={e => updateEditLineItem(index, 'serialNumbersText', e.target.value)} />
                    )}
                  </Field>
                          <Field label="Warranty">
                            <label style={styles.bulkCheckboxRow}>
                              <input type="checkbox" checked={li.hasWarranty}
                                onChange={e => updateEditLineItem(index, 'hasWarranty', e.target.checked)} />
                              <span>This batch has a warranty</span>
                            </label>
                            {li.hasWarranty && (
                              <input type="date" style={styles.input} value={li.warrantyUntil} required
                                onChange={e => updateEditLineItem(index, 'warrantyUntil', e.target.value)} />
                            )}
                          </Field>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <PhotoInput label="Photo (optional)" name={li.assetName} value={li.image} onChange={value => updateEditLineItem(index, 'image', value)} onUploadStateChange={setPhotoUploading} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                          <button type="button" style={styles.removeBtn} onClick={() => removeEditLineItem(index)}>Remove This Line</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <button type="button" style={styles.addLineBtn} onClick={addEditLineItem}>+ Add Line Item</button>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                  <button type="button" style={styles.removeBtn} onClick={() => setEditMode(false)}>Cancel</button>
                  <button type="submit" style={styles.submitBtn2} disabled={editSaving || photoUploading}>{editSaving ? 'Saving...' : photoUploading ? 'Uploading photo...' : 'Save Changes'}</button>
                </div>
              </form>
            ) : (
              <>
                <div style={styles.modalHeader}>
                  <div>
                    <h2 style={styles.sectionTitle}>Invoice {selectedInvoice.invoice_number}</h2>
                    <p style={styles.sub}>
                      {selectedInvoice.invoice_date ? new Date(selectedInvoice.invoice_date).toLocaleDateString() : '-'}
                      {' · '}{selectedInvoice.vendor_name} · {selectedInvoice.project_name} · {selectedInvoice.business_head_name}
                    </p>
                  </div>
                  <button type="button" style={styles.closeBtn} onClick={() => setSelectedInvoice(null)}>&times;</button>
                </div>

                {editMsg && <div style={{ ...styles.pageMsg, ...styles.pageMsgError }}>{editMsg}</div>}

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead style={styles.thead}>
                      <tr>
                        <th style={styles.th}>Item</th>
                        <th style={styles.th}>Classification</th>
                        <th style={styles.th}>Qty</th>
                        <th style={styles.th}>Unit Price</th>
                        <th style={styles.th}>GST %</th>
                        <th style={styles.th}>Total</th>
                        <th style={styles.th}>Asset Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.lineItems.map(li => (
                        <tr key={li.id} style={styles.tr}>
                          <td style={styles.td}>{li.asset_name}</td>
                          <td style={styles.td}>{li.classification_name}</td>
                          <td style={styles.td}>{li.bill_quantity}</td>
                          <td style={styles.td}>{formatInr(li.unit_price)}</td>
                          <td style={styles.td}>{li.gst_percent}%</td>
                          <td style={styles.td}>{formatInr(li.total_value)}</td>
                          <td style={{ ...styles.td, fontSize: '11px', color: '#64748b' }}>
                            {li.assets.map(a => a.asset_tag).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={styles.totalsBox}>
                  <div>Taxable Value: <strong>{formatInr(selectedInvoice.taxable_value)}</strong></div>
                  <div>GST Value: <strong>{formatInr(selectedInvoice.gst_value)}</strong></div>
                  <div>Installation + Freight: <strong>{formatInr(Number(selectedInvoice.installation_charges || 0) + Number(selectedInvoice.freight_charges || 0))}</strong></div>
                  <div style={styles.grandTotal}>Total Bill Value: <strong>{formatInr(selectedInvoice.total_bill_value)}</strong></div>
                </div>

                <div style={styles.docsBox}>
                  <div style={styles.docsHeader}>
                    <span style={{ ...styles.sectionTitle, margin: 0 }}>Invoice Photocopy / Documents</span>
                    {isSuperAdmin && (
                      <label style={{ ...styles.docUploadBtn, opacity: docUploading ? 0.6 : 1 }}>
                        {docUploading ? 'Uploading...' : '+ Upload'}
                        <input type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
                          disabled={docUploading} onChange={handleUploadDocuments} />
                      </label>
                    )}
                  </div>
                  {docMsg && <div style={{ ...styles.pageMsg, ...styles.pageMsgError }}>{docMsg}</div>}
                  {invoiceDocuments.length === 0 ? (
                    <p style={styles.sub}>No documents attached yet.</p>
                  ) : (
                    <div style={styles.docsList}>
                      {invoiceDocuments.map(doc => (
                        <div key={doc.id} style={styles.docRow}>
                          <button type="button" style={styles.docLink} onClick={() => handleViewDocument(doc)}>
                            {doc.file_name}
                          </button>
                          <span style={styles.docMeta}>{(doc.file_size / 1024).toFixed(0)} KB</span>
                          {isSuperAdmin && (
                            <button type="button" style={styles.docDeleteBtn} onClick={() => handleDeleteDocument(doc.id)}>Delete</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button type="button" style={styles.submitBtn} disabled={downloadingPdf}
                    onClick={() => downloadInvoicePdf(selectedInvoice.id, selectedInvoice.invoice_number)}>
                    {downloadingPdf ? 'Preparing PDF...' : 'Download Invoice (PDF)'}
                  </button>
                  <button type="button" style={styles.labelsBtn}
                    onClick={() => navigate(`/admin/labels?invoiceId=${selectedInvoice.id}&centerId=${encodeURIComponent(centerId)}`)}>
                    <QrIcon size={15} /> QR labels for this invoice
                  </button>
                  {isSuperAdmin && (
                    <>
                      <button type="button" style={styles.editInvoiceBtn} onClick={startEdit}>Edit Invoice</button>
                      <button type="button" style={styles.deleteInvoiceBtn} disabled={deleting} onClick={handleDeleteInvoice}>
                        {deleting ? 'Deleting...' : 'Delete Invoice'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '1100px', margin: '0 auto' },
  header: { marginBottom: '20px' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#1a1a2e' },
  sub: { color: '#6b7280', fontSize: '13px', marginTop: '4px', maxWidth: '620px' },
  centerRow: { marginBottom: '16px' },
  centerSelect: { minWidth: '280px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  printNowBtn: { display: 'inline-flex', alignItems: 'center', gap: '7px', marginLeft: 'auto', background: '#2d2a6e', color: '#fff', border: 'none', borderRadius: '10px', padding: '9px 14px', fontWeight: 800, fontSize: '13px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  labelsBtn: { display: 'inline-flex', alignItems: 'center', gap: '7px', background: '#eef2ff', color: '#2d2a6e', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 14px', fontWeight: 800, fontSize: '13px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  pageMsg: { padding: '12px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, marginBottom: '18px' , display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  pageMsgSuccess: { background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7' },
  pageMsgError: { background: '#fce4ec', color: '#c62828', border: '1px solid #f48fb1' },
  card: { background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: '0 2px 12px rgba(26,35,126,0.07)', marginBottom: '24px' },
  sectionTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '16px', fontWeight: 800, color: '#1a237e', margin: '18px 0 12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' },
  gridMobile: { gridTemplateColumns: '1fr' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '12px', fontWeight: 700, color: '#475569' },
  input: { padding: '10px 12px', border: '1.5px solid #dbe3f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none' },
  stockHint: { fontSize: '11px', color: '#2e7d32', fontWeight: 600 },
  stockHintNew: { fontSize: '11px', color: '#ef6c00', fontWeight: 600 },
  bulkCheckboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#374151', fontWeight: 600, marginBottom: '4px', cursor: 'pointer' },
  fieldHint: { fontSize: '11px', color: '#6b7280', lineHeight: 1.45, marginTop: '2px' },
  lineItemCard: { border: '1.5px solid #eef1f8', borderRadius: '12px', padding: '16px', marginBottom: '12px', background: '#fafbfe' },
  lineItemFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' },
  lineItemCalc: { fontSize: '12px', color: '#475569', fontWeight: 600 },
  removeBtn: { background: '#fce4ec', color: '#c62828', border: 'none', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' },
  addLineBtn: { background: '#e8eaf6', color: '#1a237e', border: 'none', padding: '10px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', marginBottom: '18px' },
  totalsBox: { background: '#f8fafc', borderRadius: '10px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#374151', marginBottom: '18px' },
  grandTotal: { fontSize: '15px', color: '#1a237e', borderTop: '1px solid #dbe3f0', paddingTop: '8px', marginTop: '4px' },
  submitBtn: { background: 'linear-gradient(135deg, #f9a825, #ffb74d)', color: '#102548', border: 'none', padding: '13px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: 800, fontSize: '14px', width: '100%' },
  loading: { padding: '40px', textAlign: 'center', color: '#6b7280' },
  tableWrap: { background: '#fff', borderRadius: '14px', overflowX: 'auto', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  table: { width: '100%', minWidth: '700px', borderCollapse: 'collapse' },
  thead: { background: '#17355f' },
  th: { padding: '12px 14px', color: '#fff', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'left' },
  tr: { borderBottom: '1px solid #f0f2f8' },
  trClickable: { borderBottom: '1px solid #f0f2f8', cursor: 'pointer' },
  td: { padding: '12px 14px', fontSize: '13px', color: '#374151', verticalAlign: 'middle' },
  emptyRow: { padding: '30px 14px', textAlign: 'center', fontSize: '13px', color: '#64748b', background: '#fff' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto', zIndex: 200 },
  modalCard: { background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '900px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '16px' },
  closeBtn: { background: 'transparent', border: 'none', fontSize: '26px', lineHeight: 1, color: '#64748b', cursor: 'pointer' },
  editInvoiceBtn: { background: '#fff3e0', color: '#ef6c00', border: 'none', padding: '13px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  deleteInvoiceBtn: { background: '#fce4ec', color: '#c62828', border: 'none', padding: '13px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' },
  submitBtn2: { background: 'linear-gradient(135deg, #f9a825, #ffb74d)', color: '#102548', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 800, fontSize: '13px' },
  readonlyText: { padding: '10px 12px', fontSize: '13px', color: '#475569', fontWeight: 600 },
  editHint: { fontSize: '11px', color: '#94a3b8', marginTop: '4px' },
  newLineTag: { display: 'inline-block', background: '#e8f5e9', color: '#2e7d32', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.4px' },
  newInvoiceBtn: { background: 'linear-gradient(135deg, #f9a825, #ffb74d)', color: '#102548', border: 'none', padding: '13px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: 800, fontSize: '14px' },
  docsBox: { background: '#f8fafc', borderRadius: '10px', padding: '14px 18px', marginBottom: '18px' },
  docsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
  docUploadBtn: { display: 'inline-flex', alignItems: 'center', background: '#e8eaf6', color: '#1a237e', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  docsList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  docRow: { display: 'flex', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px' },
  docLink: { background: 'transparent', border: 'none', color: '#1565c0', fontWeight: 600, fontSize: '13px', cursor: 'pointer', padding: 0, textAlign: 'left', flex: 1, textDecoration: 'underline' },
  docMeta: { fontSize: '11px', color: '#94a3b8', flexShrink: 0 },
  docDeleteBtn: { background: 'transparent', border: 'none', color: '#c62828', fontWeight: 700, fontSize: '12px', cursor: 'pointer', flexShrink: 0 },
};
