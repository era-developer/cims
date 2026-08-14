import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams, useNavigate } from 'react-router-dom';
import SmartImage from '../components/SmartImage';
import PhotoInput from '../components/PhotoInput';
import ProgramSelect, { OTHER_PROGRAM, resolveProgramName } from '../components/ProgramSelect';
import AssetSwapPicker from '../components/AssetSwapPicker';
import AssetConditionPicker from '../components/AssetConditionPicker';
import { CENTERS } from '../centers';
import { useAuth } from '../context/AuthContext';
import useViewport from '../hooks/useViewport';
import { formatInr } from '../utils/currency';

const EMPTY_ADD_FORM = {
  classificationId: '', assetName: '', description: '', billQuantity: '', unit: 'pcs', unitPrice: '', gstPercent: 18,
  vendorName: '', invoiceNumber: '', invoiceDate: '', projectName: '', businessHeadName: '',
  purchasedFor: '', isBulk: false, serialNumbersText: '', image: '', hasWarranty: false, warrantyUntil: '',
};

const NEXT_ACTIONS = {
  available: [{ toStatus: 'damaged', label: 'Mark Damaged/Consumed' }, { toStatus: 'under_repair', label: 'Send for Repair' }],
  // "Mark Available (corrected)" covers the real-world case this whole
  // feature is for: a unit gets marked damaged when a return is processed,
  // then the student later actually brings it back in good condition (or
  // it was simply a mistaken mark) -- distinct from the repair path, which
  // implies real work was done on it.
  damaged: [{ toStatus: 'available', label: 'Mark Available (corrected)' }, { toStatus: 'under_repair', label: 'Send for Repair' }, { toStatus: 'disposed', label: 'Dispose' }],
  under_repair: [{ toStatus: 'available', label: 'Mark Repaired' }, { toStatus: 'disposed', label: 'Dispose (Beyond Repair)' }],
  issued: [], reserved: [], return_requested: [],
  disposed: [{ toStatus: 'available', label: 'Restore (disposed by mistake)' }],
};

const STATUS_LABELS = {
  available: 'Available', issued: 'Issued', reserved: 'Reserved', under_repair: 'Under Repair',
  damaged: 'Damaged/Consumed', disposed: 'Disposed', return_requested: 'Return Requested',
};

function isWarrantyExpired(warrantyUntil) {
  if (!warrantyUntil) return false;
  return new Date(warrantyUntil) < new Date();
}

// catalog-summary deliberately omits the (potentially multi-MB) image data
// for every row -- see the backend route's comment. Each thumbnail is
// fetched lazily, one small indexed lookup at a time, and cached here so
// re-opening the drawer/edit modal for an already-rendered row is instant.
const catalogImageCache = new Map();

function CatalogThumb({ catalogId, centerId, hasImage, alt, style, placeholderStyle, placeholderText = 'No photo' }) {
  const [image, setImage] = useState(() => catalogImageCache.get(catalogId) || null);

  useEffect(() => {
    if (!hasImage) return;
    const cached = catalogImageCache.get(catalogId);
    if (cached) { setImage(cached); return; }
    let cancelled = false;
    // centerId must be sent explicitly: for a super_admin (no fixed home
    // center) the backend only knows which center's copy of this catalog
    // id to look up via ?centerId=, exactly like catalog-summary already
    // does elsewhere on this page. Omitting it here was the actual bug --
    // it silently 404'd for every super_admin, so no photo ever loaded for
    // them regardless of which center they were viewing.
    axios.get(`/api/assets/catalog/${catalogId}/image`, { params: { centerId } })
      .then(({ data }) => {
        if (cancelled || !data.image) return;
        catalogImageCache.set(catalogId, data.image);
        setImage(data.image);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [catalogId, centerId, hasImage]);

  if (!hasImage || !image) return <div style={placeholderStyle}>{placeholderText}</div>;
  return <SmartImage src={image} alt={alt} style={style} fallback={<div style={placeholderStyle}>{placeholderText}</div>} />;
}

function SortableTh({ field, label, sortField, sortDirection, onSort }) {
  const active = sortField === field;
  return (
    <th
      style={{ ...styles.th, ...styles.thSortable, ...(active ? styles.thSortableActive : {}) }}
      onClick={() => onSort(field)}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={styles.sortArrow}>{active ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
    </th>
  );
}

export default function AdminInventory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isMobile } = useViewport();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [centerId, setCenterId] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('All');
  const [stockStatusFilter, setStockStatusFilter] = useState('all');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [drawerItem, setDrawerItem] = useState(null);
  const [drawerAssets, setDrawerAssets] = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [bulkForm, setBulkForm] = useState({ fromStatus: 'available', toStatus: 'damaged', count: '' });
  const [actionMsg, setActionMsg] = useState('');
  const [actionMsgType, setActionMsgType] = useState('success');
  // Shared by the add-catalog and edit-catalog PhotoInputs -- they're never
  // both open at once, so one flag is enough to block Save while a photo
  // upload (POST /api/assets/upload-image) is still in flight.
  const [photoUploading, setPhotoUploading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addLookups, setAddLookups] = useState({ classifications: [], vendors: [], businessHeads: [], projects: [] });
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [addMsg, setAddMsg] = useState('');
  const [otherAddProjectName, setOtherAddProjectName] = useState('');
  const [editingAsset, setEditingAsset] = useState(null);
  const [editAssetForm, setEditAssetForm] = useState({ assetTag: '', serialNumber: '', location: '', unitValue: '', hasWarranty: false, warrantyUntil: '' });
  const [editAssetSaving, setEditAssetSaving] = useState(false);
  const [editAssetMsg, setEditAssetMsg] = useState('');
  const [editingCatalog, setEditingCatalog] = useState(null);
  const [editCatalogForm, setEditCatalogForm] = useState({ name: '', description: '', image: '', classificationId: '', tagCode: '' });
  const [editCatalogClassifications, setEditCatalogClassifications] = useState([]);
  const [editCatalogSaving, setEditCatalogSaving] = useState(false);
  const [editCatalogMsg, setEditCatalogMsg] = useState('');
  const [editCatalogRetag, setEditCatalogRetag] = useState(false);
  const [damagePrompt, setDamagePrompt] = useState(null);
  const [damagePrograms, setDamagePrograms] = useState([]);
  const [damageProgramId, setDamageProgramId] = useState('');
  const [damageOtherProgram, setDamageOtherProgram] = useState('');
  const [damageReason, setDamageReason] = useState('');
  const [damagePromptMsg, setDamagePromptMsg] = useState('');
  const [damagePromptSaving, setDamagePromptSaving] = useState(false);
  const [internalUseOpen, setInternalUseOpen] = useState(false);
  const [internalUsePrograms, setInternalUsePrograms] = useState([]);
  const [internalUseForm, setInternalUseForm] = useState({ takenBy: '', projectId: '', otherProgramName: '', reason: '', studentCount: '', teamCount: '', instituteName: '' });
  const [internalUseRows, setInternalUseRows] = useState([{ name: '', qty: '' }]);
  const [internalUseSaving, setInternalUseSaving] = useState(false);
  const [internalUseMsg, setInternalUseMsg] = useState('');
  const [returnListOpen, setReturnListOpen] = useState(false);
  const [openInternalIssues, setOpenInternalIssues] = useState([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returningIssue, setReturningIssue] = useState(null);
  const [returnAssetForm, setReturnAssetForm] = useState({});
  const [returnDamageReason, setReturnDamageReason] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnMsg, setReturnMsg] = useState('');
  const [correctionPrompt, setCorrectionPrompt] = useState(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionMsg, setCorrectionMsg] = useState('');
  const [historyAsset, setHistoryAsset] = useState(null);
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    setCenterId(isSuperAdmin ? (CENTERS[0]?.id || '') : (user?.centerId || ''));
  }, [isSuperAdmin, user]);

  useEffect(() => {
    if (!centerId) return;
    fetchItems();
    const timer = setInterval(fetchItems, 10000);
    return () => clearInterval(timer);
  }, [centerId]);

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  // Lets the Dashboard's classification filter carry over here (e.g. its
  // "View classification" selector + "Manage Inventory" button) by passing
  // the classification name in the URL.
  useEffect(() => {
    const cls = searchParams.get('classification');
    if (cls) setClassificationFilter(cls);
  }, [searchParams]);

  useEffect(() => {
    const query = search.toLowerCase();
    let next = items;
    if (classificationFilter !== 'All') {
      next = next.filter(item => (item.classification_name || 'Unclassified') === classificationFilter);
    }
    if (query) {
      next = next.filter(item => item.name?.toLowerCase().includes(query));
    }
    if (stockStatusFilter !== 'all') {
      next = next.filter(item => {
        const lowThreshold = item.reorder_point || 5;
        if (stockStatusFilter === 'out') return item.available === 0;
        if (stockStatusFilter === 'low') return item.available > 0 && item.available < lowThreshold;
        if (stockStatusFilter === 'in') return item.available >= lowThreshold;
        return true;
      });
    }
    setFiltered(next);
  }, [search, items, classificationFilter, stockStatusFilter]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection(dir => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }

  const SORT_KEYS = {
    name: item => (item.name || '').toLowerCase(),
    classification_name: item => (item.classification_name || 'Unclassified').toLowerCase(),
    available: item => item.available, issued: item => item.issued, under_repair: item => item.under_repair,
    damaged: item => item.damaged, disposed: item => item.disposed, total: item => item.total,
    available_value: item => Number(item.available_value) || 0, damaged_value: item => Number(item.damaged_value) || 0,
    total_value: item => Number(item.total_value) || 0,
  };
  const sorted = [...filtered].sort((a, b) => {
    const keyFn = SORT_KEYS[sortField] || SORT_KEYS.name;
    const av = keyFn(a); const bv = keyFn(b);
    const dir = sortDirection === 'desc' ? -1 : 1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  function downloadInventory() {
    const token = localStorage.getItem('cims_token');
    const params = new URLSearchParams();
    params.set('centerId', centerId);
    if (classificationFilter !== 'All') params.set('classification', classificationFilter);
    if (search.trim()) params.set('search', search.trim());
    if (stockStatusFilter !== 'all') params.set('stockStatus', stockStatusFilter);
    params.set('sortField', sortField);
    params.set('sortDirection', sortDirection);
    const url = `/api/admin/download/inventory-catalog?${params.toString()}`;
    fetch(url, { headers: new Headers({ Authorization: `Bearer ${token}` }) })
      .then(response => response.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `${centerId}_inventory.xlsx`;
        link.click();
        URL.revokeObjectURL(objectUrl);
      });
  }

  async function fetchItems() {
    try {
      const { data } = await axios.get('/api/assets/catalog-summary', { params: { centerId } });
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function openAddModal() {
    setAddForm(EMPTY_ADD_FORM);
    setOtherAddProjectName('');
    setAddMsg('');
    setAddModalOpen(true);
    try {
      const { data } = await axios.get('/api/invoices/lookups', { params: { centerId } });
      setAddLookups(data);
    } catch {
      // form still usable without suggestions
    }
  }

  async function handleAddSubmit(event) {
    event.preventDefault();
    setAddMsg('');
    const f = addForm;
    const resolvedProjectName = resolveProgramName(f.projectName, otherAddProjectName);
    if (!f.classificationId || !f.assetName.trim() || !f.billQuantity || !f.unitPrice ||
        !f.vendorName.trim() || !f.invoiceNumber.trim() || !f.invoiceDate || !resolvedProjectName || !f.businessHeadName) {
      setAddMsg('Please fill in all required fields.');
      return;
    }
    setAddSaving(true);
    try {
      await axios.post('/api/invoices', {
        centerId,
        vendorName: f.vendorName.trim(), invoiceNumber: f.invoiceNumber.trim(), invoiceDate: f.invoiceDate,
        projectName: resolvedProjectName, businessHeadName: f.businessHeadName,
        installationCharges: 0, freightCharges: 0,
        lineItems: [{
          classificationId: Number(f.classificationId), assetName: f.assetName.trim(), description: f.description.trim(),
          billQuantity: Number(f.billQuantity), unit: f.unit || 'pcs', unitPrice: Number(f.unitPrice),
          gstPercent: Number(f.gstPercent) || 0, purchasedFor: f.purchasedFor.trim(),
          isBulk: f.isBulk, serialNumbers: f.serialNumbersText.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
          image: f.image.trim(),
          hasWarranty: f.hasWarranty, warrantyUntil: f.hasWarranty ? f.warrantyUntil : '',
        }],
      });
      setAddModalOpen(false);
      await fetchItems();
    } catch (err) {
      setAddMsg(err.response?.data?.message || 'Unable to add this component.');
    } finally {
      setAddSaving(false);
    }
  }

  function handleSearchChange(value) {
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  async function openDrawer(item) {
    setDrawerItem(item);
    setBulkForm({ fromStatus: 'available', toStatus: 'damaged', count: '' });
    setActionMsg('');
    setDrawerLoading(true);
    try {
      const { data } = await axios.get('/api/assets', { params: { centerId, catalogId: item.catalog_id } });
      setDrawerAssets(data);
    } catch {
      setDrawerAssets([]);
    } finally {
      setDrawerLoading(false);
    }
  }

  async function refreshDrawer() {
    if (!drawerItem) return;
    const { data } = await axios.get('/api/assets', { params: { centerId, catalogId: drawerItem.catalog_id } });
    setDrawerAssets(data);
    // Re-fetch catalog-summary directly (rather than via fetchItems) so we can
    // also refresh the drawer's own header/value-summary snapshot, which
    // otherwise keeps showing stale numbers from when the drawer was opened.
    const { data: summaryData } = await axios.get('/api/assets/catalog-summary', { params: { centerId } });
    setItems(summaryData);
    const updated = summaryData.find(i => i.catalog_id === drawerItem.catalog_id);
    if (updated) setDrawerItem(updated);
  }

  async function performTransitionOne(assetId, toStatus, programFields) {
    setActionMsg('');
    try {
      await axios.put(`/api/assets/${assetId}/status`, { toStatus, ...programFields });
      await refreshDrawer();
      setActionMsgType('success');
      setActionMsg('Unit updated.');
      return true;
    } catch (err) {
      setActionMsgType('error');
      setActionMsg(err.response?.data?.message || 'Unable to update this unit.');
      return false;
    }
  }

  function transitionOne(assetId, toStatus) {
    if (toStatus === 'damaged') {
      openDamagePrompt('single', assetId);
      return;
    }
    const asset = drawerAssets.find(a => a.id === assetId);
    if (toStatus === 'available' && asset?.status === 'damaged') {
      setCorrectionPrompt({ assetId });
      setCorrectionReason('');
      setCorrectionMsg('');
      return;
    }
    performTransitionOne(assetId, toStatus, {});
  }

  async function submitCorrection() {
    if (!correctionReason.trim()) {
      setCorrectionMsg('A reason is required for this correction.');
      return;
    }
    setCorrectionSaving(true);
    const ok = await performTransitionOne(correctionPrompt.assetId, 'available', { notes: correctionReason.trim() });
    setCorrectionSaving(false);
    if (ok) setCorrectionPrompt(null);
  }

  async function openAssetHistory(assetId) {
    setHistoryAsset({ id: assetId, loading: true, events: [] });
    try {
      const { data } = await axios.get(`/api/assets/${assetId}`);
      setHistoryAsset({ id: assetId, loading: false, assetTag: data.asset_tag, events: data.history || [] });
    } catch {
      setHistoryAsset({ id: assetId, loading: false, events: [], error: 'Unable to load history for this unit.' });
    }
  }

  function openEditAsset(asset) {
    setEditingAsset(asset);
    setEditAssetForm({
      assetTag: asset.asset_tag || '', serialNumber: asset.serial_number || '', location: asset.location || '',
      unitValue: asset.unit_value ?? '', hasWarranty: !!asset.has_warranty, warrantyUntil: asset.warranty_until || '',
    });
    setEditAssetMsg('');
  }

  async function openEditCatalog(item) {
    setEditingCatalog(item);
    setEditCatalogForm({
      name: item.name, description: item.description || '', image: '',
      classificationId: item.classification_id || '', tagCode: item.tag_code || '',
    });
    setEditCatalogRetag(false);
    setEditCatalogMsg('');
    // The real image bytes aren't in `item` (catalog-summary only sends
    // has_image -- see the backend route's comment), so fetch/await it here
    // rather than defaulting the field to '': submitting before it resolves
    // would otherwise silently wipe the component's existing photo.
    const cachedImage = item.has_image ? catalogImageCache.get(item.catalog_id) : null;
    const [lookupsResult, imageResult] = await Promise.allSettled([
      axios.get('/api/invoices/lookups', { params: { centerId } }),
      item.has_image && !cachedImage ? axios.get(`/api/assets/catalog/${item.catalog_id}/image`, { params: { centerId } }) : Promise.resolve(null),
    ]);
    if (lookupsResult.status === 'fulfilled') {
      setEditCatalogClassifications(lookupsResult.value.data.classifications);
    }
    const resolvedImage = cachedImage || (imageResult.status === 'fulfilled' && imageResult.value ? imageResult.value.data.image : '') || '';
    if (resolvedImage) catalogImageCache.set(item.catalog_id, resolvedImage);
    setEditCatalogForm(f => ({ ...f, image: resolvedImage }));
  }

  async function handleEditCatalogSubmit(event) {
    event.preventDefault();
    setEditCatalogMsg('');
    if (!editCatalogForm.name.trim()) {
      setEditCatalogMsg('Name cannot be empty.');
      return;
    }
    setEditCatalogSaving(true);
    try {
      const { data } = await axios.put(`/api/assets/catalog/${editingCatalog.catalog_id}`, {
        name: editCatalogForm.name.trim(), description: editCatalogForm.description,
        image: editCatalogForm.image, classificationId: Number(editCatalogForm.classificationId),
        tagCode: editCatalogForm.tagCode, retagExisting: editCatalogRetag,
      });
      setEditingCatalog(null);
      setActionMsgType('success');
      const parts = ['Saved.'];
      if (data.mergedIntoName) {
        parts.push(`Merged ${data.mergedAssetCount} unit(s) into the existing component "${data.mergedIntoName}" — the duplicate entry was removed.`);
      }
      if (data.retaggedCount) parts.push(`Re-tagged ${data.retaggedCount} existing unit(s) to match.`);
      if (data.propagatedCenters?.length) parts.push(`Synced to ${data.propagatedCenters.length} other center(s).`);
      if (data.mergedCenters?.length) {
        parts.push(`Also merged duplicates in: ${data.mergedCenters.map(m => `${m.centerId} (${m.assetsMoved} unit(s))`).join(', ')}.`);
      }
      setActionMsg(parts.join(' '));
      await fetchItems();
      await refreshDrawer();
    } catch (err) {
      setEditCatalogMsg(err.response?.data?.message || 'Unable to save changes.');
    } finally {
      setEditCatalogSaving(false);
    }
  }

  async function handleEditAssetSubmit(event) {
    event.preventDefault();
    setEditAssetMsg('');
    setEditAssetSaving(true);
    try {
      await axios.put(`/api/assets/${editingAsset.id}`, {
        assetTag: editAssetForm.assetTag, serialNumber: editAssetForm.serialNumber, location: editAssetForm.location,
        unitValue: editAssetForm.unitValue === '' ? null : Number(editAssetForm.unitValue),
        hasWarranty: editAssetForm.hasWarranty, warrantyUntil: editAssetForm.hasWarranty ? editAssetForm.warrantyUntil : '',
      });
      setEditingAsset(null);
      await refreshDrawer();
      setActionMsgType('success');
      setActionMsg(`${editingAsset.asset_tag} updated.`);
    } catch (err) {
      setEditAssetMsg(err.response?.data?.message || 'Unable to save changes.');
    } finally {
      setEditAssetSaving(false);
    }
  }

  async function handleDeleteAsset() {
    if (!window.confirm(`Delete unit ${editingAsset.asset_tag} permanently? This cannot be undone. Units with issue/transfer history can't be deleted -- use Dispose for those.`)) {
      return;
    }
    setEditAssetSaving(true);
    try {
      await axios.delete(`/api/assets/${editingAsset.id}`);
      setEditingAsset(null);
      await refreshDrawer();
      await fetchItems();
      setActionMsgType('success');
      setActionMsg(`${editingAsset.asset_tag} deleted.`);
    } catch (err) {
      setEditAssetMsg(err.response?.data?.message || 'Unable to delete this unit.');
    } finally {
      setEditAssetSaving(false);
    }
  }

  async function handleDeleteCatalog() {
    if (!window.confirm(`Delete "${editingCatalog.name}" from the catalog entirely (all centers)? This only works if no center has any stock under it, and cannot be undone.`)) {
      return;
    }
    setEditCatalogSaving(true);
    try {
      const { data } = await axios.delete(`/api/assets/catalog/${editingCatalog.catalog_id}`);
      setEditingCatalog(null);
      setActionMsgType('success');
      setActionMsg(data.message);
      await fetchItems();
    } catch (err) {
      setEditCatalogMsg(err.response?.data?.message || 'Unable to delete this component.');
    } finally {
      setEditCatalogSaving(false);
    }
  }

  async function openInternalUseModal() {
    setInternalUseForm({ takenBy: '', projectId: '', otherProgramName: '', reason: '', studentCount: '', teamCount: '', instituteName: '' });
    setInternalUseRows([{ name: '', qty: '' }]);
    setInternalUseMsg('');
    setInternalUseOpen(true);
    try {
      const { data } = await axios.get('/api/programs', { params: { centerId } });
      setInternalUsePrograms(data);
    } catch {
      // form still usable without the dropdown populated
    }
  }

  function updateInternalUseRow(index, field, value) {
    setInternalUseRows(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addInternalUseRow() {
    setInternalUseRows(prev => [...prev, { name: '', qty: '' }]);
  }

  function removeInternalUseRow(index) {
    setInternalUseRows(prev => prev.filter((_, i) => i !== index));
  }

  async function handleInternalUseSubmit(event) {
    event.preventDefault();
    setInternalUseMsg('');
    const isOtherProgram = internalUseForm.projectId === OTHER_PROGRAM;
    const hasProgram = isOtherProgram ? internalUseForm.otherProgramName.trim() : internalUseForm.projectId;
    if (!internalUseForm.takenBy.trim() || !hasProgram || !internalUseForm.reason.trim()) {
      setInternalUseMsg('Fill in who is taking the components, the program, and the reason.');
      return;
    }
    const resolvedItems = [];
    for (const row of internalUseRows) {
      const name = row.name.trim();
      const qty = Number(row.qty);
      if (!name && !qty) continue;
      const match = items.find(item => item.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        setInternalUseMsg(`"${row.name}" doesn't match a component in this center's catalog. Pick one from the suggestions.`);
        return;
      }
      if (!qty || qty <= 0) {
        setInternalUseMsg(`Enter a quantity for ${match.name}.`);
        return;
      }
      resolvedItems.push({ catalogId: match.catalog_id, name: match.name, qty });
    }
    if (!resolvedItems.length) {
      setInternalUseMsg('Add at least one component.');
      return;
    }

    setInternalUseSaving(true);
    try {
      await axios.post('/api/internal-issues', {
        centerId, takenBy: internalUseForm.takenBy.trim(),
        ...(isOtherProgram
          ? { otherProgramName: internalUseForm.otherProgramName.trim() }
          : { projectId: Number(internalUseForm.projectId) }),
        reason: internalUseForm.reason.trim(), items: resolvedItems,
        studentCount: internalUseForm.studentCount, teamCount: internalUseForm.teamCount,
        instituteName: internalUseForm.instituteName.trim(),
      });
      setInternalUseOpen(false);
      await fetchItems();
      setActionMsgType('success');
      setActionMsg('Internal use recorded and stock updated.');
    } catch (err) {
      setInternalUseMsg(err.response?.data?.message || 'Unable to record internal use.');
    } finally {
      setInternalUseSaving(false);
    }
  }

  async function openReturnListModal() {
    setReturnListOpen(true);
    setReturnMsg('');
    setReturningIssue(null);
    setReturnLoading(true);
    try {
      const { data } = await axios.get('/api/internal-issues', { params: { centerId } });
      setOpenInternalIssues(data.filter(i => i.status !== 'Returned'));
    } catch (err) {
      setReturnMsg(err.response?.data?.message || 'Unable to load internal issues.');
    } finally {
      setReturnLoading(false);
    }
  }

  function openReturnEntry(issue) {
    setReturningIssue(issue);
    setReturnMsg('');
    const initial = {};
    issue.items.forEach(item => {
      const issuedAssets = Array.isArray(item.assets) ? item.assets.filter(a => a.status === 'issued') : [];
      initial[item.id] = issuedAssets.map(a => ({ ...a, condition: 'skip' }));
    });
    setReturnAssetForm(initial);
    setReturnDamageReason('');
  }

  function setReturnAssetCondition(itemId, assetId, condition) {
    setReturnAssetForm(prev => ({
      ...prev,
      [itemId]: (prev[itemId] || []).map(a => (a.id === assetId ? { ...a, condition } : a)),
    }));
  }

  async function refreshReturningIssue() {
    if (!returningIssue) return;
    try {
      const { data } = await axios.get(`/api/internal-issues/${returningIssue.id}`);
      setReturningIssue(data);
      // A swap changes which asset IDs exist for that item -- rebuild its
      // condition picker from the fresh list rather than holding onto
      // stale/now-invalid asset IDs.
      const rebuilt = {};
      data.items.forEach(item => {
        const issuedAssets = Array.isArray(item.assets) ? item.assets.filter(a => a.status === 'issued') : [];
        rebuilt[item.id] = issuedAssets.map(a => ({ ...a, condition: 'skip' }));
      });
      setReturnAssetForm(rebuilt);
    } catch {
      // Swap already succeeded server-side; a stale asset tag list here is harmless.
    }
  }

  async function handleReturnSubmit() {
    setReturnMsg('');
    const payloadItems = Object.entries(returnAssetForm)
      .map(([itemId, assets]) => ({
        itemId: Number(itemId),
        returnedAssetIds: assets.filter(a => a.condition === 'good').map(a => a.id),
        damagedAssetIds: assets.filter(a => a.condition === 'damaged').map(a => a.id),
      }))
      .filter(entry => entry.returnedAssetIds.length || entry.damagedAssetIds.length);
    if (!payloadItems.length) {
      setReturnMsg('Select the condition for at least one returned unit.');
      return;
    }
    const anyDamaged = payloadItems.some(entry => entry.damagedAssetIds.length);
    if (anyDamaged && !returnDamageReason.trim()) {
      setReturnMsg('Enter a reason for the unit(s) being returned damaged.');
      return;
    }
    setReturnSaving(true);
    try {
      await axios.post(`/api/internal-issues/${returningIssue.id}/return`, { items: payloadItems, damageReason: returnDamageReason.trim() });
      await fetchItems();
      await openReturnListModal();
      setActionMsgType('success');
      setActionMsg(`${returningIssue.issueCode} return recorded.`);
    } catch (err) {
      setReturnMsg(err.response?.data?.message || 'Unable to record the return.');
    } finally {
      setReturnSaving(false);
    }
  }

  async function performBulkAction(programFields) {
    setActionMsg('');
    try {
      const { data } = await axios.put('/api/assets/bulk-status', {
        centerId, catalogId: drawerItem.catalog_id, fromStatus: bulkForm.fromStatus,
        toStatus: bulkForm.toStatus, count: Number(bulkForm.count), ...programFields,
      });
      await refreshDrawer();
      setActionMsgType('success');
      setActionMsg(`${data.updated} unit(s) moved to ${STATUS_LABELS[bulkForm.toStatus]}.`);
      setBulkForm({ ...bulkForm, count: '' });
      return true;
    } catch (err) {
      setActionMsgType('error');
      setActionMsg(err.response?.data?.message || 'Unable to complete bulk action.');
      return false;
    }
  }

  function handleBulkAction() {
    if (!drawerItem || !bulkForm.count || Number(bulkForm.count) <= 0) {
      setActionMsgType('error');
      setActionMsg('Enter how many units to move.');
      return;
    }
    if (bulkForm.toStatus === 'damaged') {
      openDamagePrompt('bulk');
      return;
    }
    performBulkAction({});
  }

  async function openDamagePrompt(mode, assetId) {
    setDamagePrompt({ mode, assetId });
    setDamageProgramId('');
    setDamageOtherProgram('');
    setDamageReason('');
    setDamagePromptMsg('');
    try {
      const { data } = await axios.get('/api/programs', { params: { centerId } });
      setDamagePrograms(data);
    } catch {
      // prompt still usable, just without dropdown options populated
    }
  }

  async function handleDamagePromptConfirm() {
    setDamagePromptMsg('');
    const isOther = damageProgramId === OTHER_PROGRAM;
    if (!damageProgramId || (isOther && !damageOtherProgram.trim())) {
      setDamagePromptMsg('Select which program this damage happened in.');
      return;
    }
    if (!damageReason.trim()) {
      setDamagePromptMsg('Enter a reason for the damage/consumption.');
      return;
    }
    const programFields = {
      ...(isOther ? { otherProgram: damageOtherProgram.trim() } : { projectId: Number(damageProgramId) }),
      notes: damageReason.trim(),
    };

    setDamagePromptSaving(true);
    let ok = false;
    if (damagePrompt.mode === 'single') {
      ok = await performTransitionOne(damagePrompt.assetId, 'damaged', programFields);
    } else {
      ok = await performBulkAction(programFields);
    }
    setDamagePromptSaving(false);
    if (ok) setDamagePrompt(null);
  }

  const totalDamaged = items.reduce((sum, item) => sum + (item.damaged || 0), 0);
  const totalValue = items.reduce((sum, item) => sum + (Number(item.total_value) || 0), 0);
  const lowStockCount = items.filter(item => item.available < (item.reorder_point || 5)).length;
  const classifications = ['All', ...Array.from(new Set(items.map(item => item.classification_name || 'Unclassified'))).sort((a, b) => a.localeCompare(b))];

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Inventory Management</h1>
            <p style={styles.sub}>{items.length} components · {lowStockCount} low stock · {totalDamaged} damaged/consumed · Total Value {formatInr(totalValue)}</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', ...(isMobile ? { width: '100%', flexDirection: 'column' } : {}) }}>
            <button style={{ ...styles.addBtnSecondary, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={openInternalUseModal}>
              Internal Use
            </button>
            <button style={{ ...styles.addBtnSecondary, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={openReturnListModal}>
              Return
            </button>
            {isSuperAdmin && (
              <button style={{ ...styles.addBtnSecondary, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={openAddModal}>
                + Add Component
              </button>
            )}
            <button style={{ ...styles.addBtn, ...(isMobile ? styles.fullWidthBtn : {}) }} onClick={() => navigate('/admin/invoices')}>
              {isSuperAdmin ? 'Full Invoice Entry' : 'View Invoices'}
            </button>
          </div>
        </div>

        {isSuperAdmin && (
          <div style={styles.centerRow}>
            <select value={centerId} onChange={event => setCenterId(event.target.value)} style={styles.centerSelect}>
              {CENTERS.map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ ...styles.toolbar, ...(isMobile ? styles.toolbarStack : {}) }}>
          <input
            style={{ ...styles.search, ...(isMobile ? styles.searchMobile : {}) }}
            placeholder="Search components..."
            value={search}
            onChange={event => handleSearchChange(event.target.value)}
          />
          <select value={classificationFilter} onChange={event => setClassificationFilter(event.target.value)} style={styles.filterSelect}>
            {classifications.map(c => <option key={c} value={c}>{c === 'All' ? 'All Classifications' : c}</option>)}
          </select>
          <select value={stockStatusFilter} onChange={event => setStockStatusFilter(event.target.value)} style={styles.filterSelect}>
            <option value="all">All Stock Levels</option>
            <option value="in">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
          <button style={styles.downloadInventoryBtn} onClick={downloadInventory}>
            Download Excel ({sorted.length})
          </button>
        </div>

        {loading ? (
          <div style={styles.loading}>Loading inventory...</div>
        ) : (
          <div style={{ ...styles.tableWrap, ...styles.mainTableWrap }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  <th style={styles.th}>Photo</th>
                  <SortableTh field="name" label="Component" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="classification_name" label="Classification" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="available" label="Available" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="issued" label="Issued" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="under_repair" label="Under Repair" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="damaged" label="Damaged/Consumed" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="disposed" label="Disposed" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="total" label="Total" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="available_value" label="Available Value" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="damaged_value" label="Damaged/Consumed Value" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <SortableTh field="total_value" label="Total Value" sortField={sortField} sortDirection={sortDirection} onSort={toggleSort} />
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td style={styles.td} colSpan={12}>No components found.</td></tr>
                )}
                {sorted.map((item, index) => {
                  const lowStock = item.available < (item.reorder_point || 5);
                  const stockColor = item.available > 10 ? '#2e7d32' : item.available > 0 ? '#f57f17' : '#c62828';
                  const stockBg = item.available > 10 ? '#e8f5e9' : item.available > 0 ? '#fff9c4' : '#fce4ec';
                  return (
                    <tr key={item.catalog_id} style={{ ...styles.tr, background: index % 2 === 0 ? '#fff' : '#fafbff' }}>
                      <td style={styles.td}>
                        <CatalogThumb catalogId={item.catalog_id} centerId={centerId} hasImage={!!item.has_image} alt={item.name} style={styles.thumb} placeholderStyle={styles.thumbPlaceholder} />
                      </td>
                      <td style={styles.td}>
                        <div style={styles.compName}>{item.name}</div>
                        {lowStock && <div style={styles.lowStockTag}>Low stock</div>}
                        {!!item.units_under_warranty && (
                          <div style={styles.warrantyTag}>
                            {item.units_under_warranty} unit{item.units_under_warranty === 1 ? '' : 's'} under warranty — see View Units for dates
                          </div>
                        )}
                      </td>
                      <td style={styles.td}><span style={styles.catTag}>{item.classification_name || 'Unclassified'}</span></td>
                      <td style={styles.td}><span style={{ ...styles.stockNum, color: stockColor, background: stockBg }}>{item.available}</span></td>
                      <td style={{ ...styles.td, textAlign: 'center', fontWeight: 700, color: '#e65100' }}>{item.issued}</td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>{item.under_repair}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.damageBadge, ...(item.damaged ? styles.damageBadgeWarn : styles.damageBadgeOk) }}>{item.damaged}</span>
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>{item.disposed}</td>
                      <td style={{ ...styles.td, textAlign: 'center', fontWeight: 700 }}>{item.total}</td>
                      <td style={{ ...styles.td, color: '#2e7d32', fontWeight: 600 }}>{formatInr(item.available_value)}</td>
                      <td style={{ ...styles.td, color: '#c62828', fontWeight: 600 }}>{formatInr(item.damaged_value)}</td>
                      <td style={{ ...styles.td, fontWeight: 700, color: '#1a237e' }}>{formatInr(item.total_value)}</td>
                      <td style={styles.td}>
                        <div style={styles.actions}>
                          {isSuperAdmin && <button style={styles.editBtn} onClick={() => openEditCatalog(item)}>Edit</button>}
                          <button style={styles.viewBtn} onClick={() => openDrawer(item)}>View Units</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerItem && (
        <div style={styles.overlay} onClick={() => setDrawerItem(null)}>
          <div style={{ ...styles.drawer, ...styles.unitsDrawer, ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <CatalogThumb catalogId={drawerItem.catalog_id} centerId={centerId} hasImage={!!drawerItem.has_image} alt={drawerItem.name} style={styles.drawerPhoto} placeholderStyle={styles.drawerPhotoPlaceholder} />
              <div style={{ flex: 1 }}>
                <h3 style={styles.modalTitle}>{drawerItem.name}</h3>
                <p style={styles.sub}>{drawerItem.classification_name || 'Unclassified'} · {drawerAssets.length} units loaded</p>
                {drawerItem.description && <p style={styles.drawerDescription}>{drawerItem.description}</p>}
              </div>
              <button style={styles.closeBtn} onClick={() => setDrawerItem(null)}>X</button>
            </div>

            <div style={styles.valueBox}>
              <div>Available Value: <strong>{formatInr(drawerItem.available_value)}</strong></div>
              <div>Damaged/Consumed Value: <strong>{formatInr(drawerItem.damaged_value)}</strong></div>
              <div style={styles.valueBoxTotal}>Total Value: <strong>{formatInr(drawerItem.total_value)}</strong></div>
            </div>

            {actionMsg && (
              <div style={{ ...styles.actionMsg, ...(actionMsgType === 'error' ? styles.actionMsgError : styles.actionMsgSuccess) }}>
                {actionMsg}
              </div>
            )}

            <div style={styles.bulkBox}>
              <span style={styles.bulkLabel}>Bulk action:</span>
              <select style={styles.bulkSelect} value={bulkForm.fromStatus} onChange={e => setBulkForm({ ...bulkForm, fromStatus: e.target.value })}>
                {['available', 'damaged', 'under_repair'].map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              <span>&rarr;</span>
              <select style={styles.bulkSelect} value={bulkForm.toStatus} onChange={e => setBulkForm({ ...bulkForm, toStatus: e.target.value })}>
                {(NEXT_ACTIONS[bulkForm.fromStatus] || []).map(a => <option key={a.toStatus} value={a.toStatus}>{STATUS_LABELS[a.toStatus]}</option>)}
              </select>
              <input type="number" min="1" style={styles.bulkCount} placeholder="Qty"
                value={bulkForm.count} onChange={e => setBulkForm({ ...bulkForm, count: e.target.value })} />
              <button style={styles.bulkBtn} onClick={handleBulkAction}>Apply</button>
            </div>

            {drawerLoading ? (
              <div style={styles.loading}>Loading units...</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thead}>
                      <th style={styles.th}>Asset Tag</th>
                      <th style={styles.th}>Serial #</th>
                      <th style={styles.th}>Unit Price</th>
                      <th style={styles.th}>Vendor</th>
                      <th style={styles.th}>Invoice #</th>
                      <th style={styles.th}>Purchase Date</th>
                      <th style={styles.th}>Warranty</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Damaged/Consumed In Program</th>
                      <th style={styles.th}>Damage/Consumed Reason</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawerAssets.map((asset, index) => (
                      <tr key={asset.id} style={{ ...styles.tr, background: index % 2 === 0 ? '#fff' : '#fafbff' }}>
                        <td style={styles.td}>{asset.asset_tag}</td>
                        <td style={styles.td}>{asset.serial_number || '-'}</td>
                        <td style={styles.td}>{asset.unit_value != null ? formatInr(asset.unit_value) : '-'}</td>
                        <td style={styles.td}>{asset.vendor_name || '-'}</td>
                        <td style={styles.td}>{asset.invoice_number || '-'}</td>
                        <td style={styles.td}>{asset.invoice_date ? new Date(asset.invoice_date).toLocaleDateString() : '-'}</td>
                        <td style={styles.td}>
                          {asset.has_warranty ? (
                            <span style={isWarrantyExpired(asset.warranty_until) ? styles.warrantyTagExpired : styles.warrantyTag}>
                              {isWarrantyExpired(asset.warranty_until) ? 'Expired ' : 'Till '}{new Date(asset.warranty_until).toLocaleDateString()}
                            </span>
                          ) : '-'}
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge}>{STATUS_LABELS[asset.status] || asset.status}</span>
                        </td>
                        <td style={styles.td}>
                          {asset.damaged_in_program
                            ? <span style={styles.damageProgramTag}>{asset.damaged_in_program}</span>
                            : '-'}
                        </td>
                        <td style={{ ...styles.td, maxWidth: '200px' }}>{asset.damaged_reason || '-'}</td>
                        <td style={styles.td}>
                          <div style={styles.actions}>
                            <button style={styles.editBtn} onClick={() => openAssetHistory(asset.id)}>History</button>
                            {isSuperAdmin && <button style={styles.editBtn} onClick={() => openEditAsset(asset)}>Edit</button>}
                            {(NEXT_ACTIONS[asset.status] || []).map(action => (
                              <button key={action.toStatus} style={styles.editBtn} onClick={() => transitionOne(asset.id, action.toStatus)}>
                                {action.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {correctionPrompt && (
        <div style={styles.overlay} onClick={() => !correctionSaving && setCorrectionPrompt(null)}>
          <div style={{ ...styles.drawer, maxWidth: '420px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <h3 style={styles.modalTitle}>Correct this unit back to Available</h3>
              <button style={styles.closeBtn} onClick={() => setCorrectionPrompt(null)} disabled={correctionSaving}>X</button>
            </div>
            <p style={styles.sub}>
              Use this only to correct a mistake -- e.g. it was marked damaged but the student actually returned it
              in good condition, or it was marked damaged by mistake.
            </p>
            {correctionMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{correctionMsg}</div>}
            <AField label="Reason for this correction">
              <input style={styles.bulkSelect2} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} />
            </AField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
              <button type="button" style={styles.addBtnSecondary} onClick={() => setCorrectionPrompt(null)} disabled={correctionSaving}>Cancel</button>
              <button type="button" style={styles.addBtn} disabled={correctionSaving} onClick={submitCorrection}>
                {correctionSaving ? 'Saving...' : 'Confirm: Mark Available'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyAsset && (
        <div style={styles.overlay} onClick={() => setHistoryAsset(null)}>
          <div style={{ ...styles.drawer, maxWidth: '640px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <h3 style={styles.modalTitle}>Lifecycle history{historyAsset.assetTag ? `: ${historyAsset.assetTag}` : ''}</h3>
              <button style={styles.closeBtn} onClick={() => setHistoryAsset(null)}>X</button>
            </div>
            {historyAsset.loading ? (
              <div style={styles.loading}>Loading history...</div>
            ) : historyAsset.error ? (
              <p style={styles.sub}>{historyAsset.error}</p>
            ) : !historyAsset.events.length ? (
              <p style={styles.sub}>No lifecycle events recorded for this unit yet.</p>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thead}>
                      <th style={styles.th}>Event</th>
                      <th style={styles.th}>From → To</th>
                      <th style={styles.th}>When</th>
                      <th style={styles.th}>By</th>
                      <th style={styles.th}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyAsset.events.map((event, idx) => (
                      <tr key={idx} style={{ ...styles.tr, background: idx % 2 === 0 ? '#fff' : '#fafbff' }}>
                        <td style={styles.td}>{event.event_type}</td>
                        <td style={styles.td}>{event.from_status || '-'} → {event.to_status}</td>
                        <td style={styles.td}>{event.occurred_at ? new Date(event.occurred_at).toLocaleString() : '-'}</td>
                        <td style={styles.td}>{event.performed_by || '-'}</td>
                        <td style={styles.td}>{event.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {damagePrompt && (
        <div style={styles.overlay} onClick={() => !damagePromptSaving && setDamagePrompt(null)}>
          <div style={{ ...styles.drawer, maxWidth: '440px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div>
                <h3 style={styles.modalTitle}>Which program was this damaged/consumed in?</h3>
                <p style={styles.sub}>
                  {damagePrompt.mode === 'bulk'
                    ? `Marking ${bulkForm.count} unit(s) as Damaged/Consumed.`
                    : 'Marking this unit as Damaged/Consumed.'}
                </p>
              </div>
              <button style={styles.closeBtn} onClick={() => setDamagePrompt(null)} disabled={damagePromptSaving}>X</button>
            </div>
            {damagePromptMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{damagePromptMsg}</div>}
            <ProgramSelect
              programs={damagePrograms} mode="id" label="Program" required
              value={damageProgramId} otherValue={damageOtherProgram}
              onChange={setDamageProgramId} onOtherChange={setDamageOtherProgram}
              placeholder="Describe what this damage was for..."
            />
            <div style={{ marginTop: '12px' }}>
              <AField label="Reason for damage/consumption">
                <textarea style={{ ...styles.bulkSelect2, height: '60px' }} value={damageReason}
                  onChange={e => setDamageReason(e.target.value)}
                  placeholder="What happened to it? (e.g. dropped during soldering, motor burnt out, filament used up)" />
              </AField>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button type="button" style={styles.addBtnSecondary} onClick={() => setDamagePrompt(null)} disabled={damagePromptSaving}>
                Cancel
              </button>
              <button type="button" style={styles.addBtn} onClick={handleDamagePromptConfirm} disabled={damagePromptSaving}>
                {damagePromptSaving ? 'Saving...' : 'Confirm Damaged/Consumed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAsset && (
        <div style={styles.overlay} onClick={() => setEditingAsset(null)}>
          <div style={{ ...styles.drawer, maxWidth: '460px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div>
                <h3 style={styles.modalTitle}>Edit {editingAsset.asset_tag}</h3>
                <p style={styles.sub}>{editingAsset.name}</p>
              </div>
              <button style={styles.closeBtn} onClick={() => setEditingAsset(null)}>X</button>
            </div>
            {editAssetMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{editAssetMsg}</div>}
            <form onSubmit={handleEditAssetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <AField label="Asset Tag">
                <input style={styles.bulkSelect2} value={editAssetForm.assetTag}
                  onChange={e => setEditAssetForm({ ...editAssetForm, assetTag: e.target.value })} />
              </AField>
              <AField label="Serial Number">
                <input style={styles.bulkSelect2} value={editAssetForm.serialNumber}
                  onChange={e => setEditAssetForm({ ...editAssetForm, serialNumber: e.target.value })} />
              </AField>
              <AField label="Location / Bin">
                <input style={styles.bulkSelect2} value={editAssetForm.location}
                  onChange={e => setEditAssetForm({ ...editAssetForm, location: e.target.value })} />
              </AField>
              <AField label="Unit Price">
                <input type="number" min="0" step="0.01" style={styles.bulkSelect2} value={editAssetForm.unitValue}
                  onChange={e => setEditAssetForm({ ...editAssetForm, unitValue: e.target.value })} />
              </AField>
              <AField label="Warranty (this unit only)">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151' }}>
                  <input type="checkbox" checked={editAssetForm.hasWarranty}
                    onChange={e => setEditAssetForm({ ...editAssetForm, hasWarranty: e.target.checked })} />
                  This unit has a warranty
                </label>
                {editAssetForm.hasWarranty && (
                  <input type="date" style={{ ...styles.bulkSelect2, marginTop: '8px' }} value={editAssetForm.warrantyUntil}
                    onChange={e => setEditAssetForm({ ...editAssetForm, warrantyUntil: e.target.value })} required />
                )}
              </AField>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <button type="button" style={styles.deleteBtn} disabled={editAssetSaving} onClick={handleDeleteAsset}>
                  Delete Unit
                </button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" style={styles.addBtnSecondary} onClick={() => setEditingAsset(null)}>Cancel</button>
                  <button type="submit" style={styles.addBtn} disabled={editAssetSaving}>
                    {editAssetSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingCatalog && (
        <div style={styles.overlay} onClick={() => setEditingCatalog(null)}>
          <div style={{ ...styles.drawer, maxWidth: '520px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div>
                <h3 style={styles.modalTitle}>Edit Component</h3>
                <p style={styles.sub}>Changes apply to every unit of this component (name shown to students, description, photo, classification).</p>
              </div>
              <button style={styles.closeBtn} onClick={() => setEditingCatalog(null)}>X</button>
            </div>
            {editCatalogMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{editCatalogMsg}</div>}
            <form onSubmit={handleEditCatalogSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <AField label="Name">
                <input style={styles.bulkSelect2} value={editCatalogForm.name} list="edit-catalog-name-list"
                  onChange={e => setEditCatalogForm({ ...editCatalogForm, name: e.target.value })} required />
                <datalist id="edit-catalog-name-list">
                  {items.filter(i => i.catalog_id !== editingCatalog?.catalog_id).map(i => <option key={i.catalog_id} value={i.name} />)}
                </datalist>
                {items.some(i => i.catalog_id !== editingCatalog?.catalog_id && i.name === editCatalogForm.name.trim()) ? (
                  <p style={styles.mergeHintActive}>
                    "{editCatalogForm.name.trim()}" already exists — saving will merge this component's units into it and remove this duplicate entry.
                  </p>
                ) : (
                  <p style={styles.mergeHint}>
                    Renaming to an existing component's exact name merges this one into it (its units move over, this entry is removed) —
                    useful for combining duplicates like "Battery 9v" / "Battery 9 V". Start typing to see existing names.
                  </p>
                )}
              </AField>
              <AField label="Classification">
                <select style={styles.bulkSelect2} value={editCatalogForm.classificationId}
                  onChange={e => setEditCatalogForm({ ...editCatalogForm, classificationId: e.target.value })}>
                  {editCatalogClassifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </AField>
              <AField label="Description (shown to students)">
                <textarea style={{ ...styles.bulkSelect2, height: '60px' }} value={editCatalogForm.description}
                  onChange={e => setEditCatalogForm({ ...editCatalogForm, description: e.target.value })} />
              </AField>
              <AField label="Tag Code (short, readable — e.g. ARDU for Arduino Uno)">
                <input style={styles.bulkSelect2} value={editCatalogForm.tagCode}
                  onChange={e => setEditCatalogForm({ ...editCatalogForm, tagCode: e.target.value.toUpperCase() })}
                  placeholder="Leave blank to keep the default numeric tag" />
                <p style={styles.sub}>
                  Once set, new units of this component get tags like {editCatalogForm.tagCode
                    ? `<CENTER>/<CLASS>/${editCatalogForm.tagCode}-01` : '<CENTER>/<CLASS>/<CODE>-01'} instead of the plain numbered tag.
                </p>
                {editCatalogForm.tagCode && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151' }}>
                    <input type="checkbox" checked={editCatalogRetag} onChange={e => setEditCatalogRetag(e.target.checked)} />
                    Also re-tag every existing unit of this component to match (renumbered {editCatalogForm.tagCode}-01, -02, ...).
                    Only do this if these tags haven't been printed on physical labels yet.
                  </label>
                )}
              </AField>
              <PhotoInput label="Photo" value={editCatalogForm.image} onChange={value => setEditCatalogForm({ ...editCatalogForm, image: value })} onUploadStateChange={setPhotoUploading} />
              <p style={styles.warrantyMovedNote}>
                Warranty is set per purchase batch (different units of this component can have different warranty
                dates) — set it on the invoice line item when adding stock, or per unit in View Units.
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <button type="button" style={styles.deleteBtn} disabled={editCatalogSaving} onClick={handleDeleteCatalog}>
                  Delete Component
                </button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" style={styles.addBtnSecondary} onClick={() => setEditingCatalog(null)}>Cancel</button>
                  <button type="submit" style={styles.addBtn} disabled={editCatalogSaving || photoUploading}>
                    {editCatalogSaving ? 'Saving...' : photoUploading ? 'Uploading photo...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {addModalOpen && (
        <div style={styles.overlay} onClick={() => setAddModalOpen(false)}>
          <div style={{ ...styles.drawer, maxWidth: '640px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div>
                <h3 style={styles.modalTitle}>Add Component</h3>
                <p style={styles.sub}>Creates a real invoice record for this purchase — every unit still gets a unique ID and traces back to it.</p>
              </div>
              <button style={styles.closeBtn} onClick={() => setAddModalOpen(false)}>X</button>
            </div>

            {addMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{addMsg}</div>}

            <form onSubmit={handleAddSubmit} style={{ ...styles.addGrid, ...(isMobile ? styles.addGridMobile : {}) }}>
              <AField label="Classification *">
                <select style={styles.bulkSelect2} value={addForm.classificationId} required
                  onChange={e => setAddForm({ ...addForm, classificationId: e.target.value })}>
                  <option value="">Select...</option>
                  {addLookups.classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </AField>
              <AField label="Asset Name / Description *">
                <input style={styles.bulkSelect2} list="add-catalog-list" value={addForm.assetName} required
                  onChange={e => setAddForm({ ...addForm, assetName: e.target.value })} />
                <datalist id="add-catalog-list">
                  {items.map(c => <option key={c.catalog_id} value={c.name} />)}
                </datalist>
              </AField>
              <AField label="Description (shown to students)" fullWidth>
                <textarea style={{ ...styles.bulkSelect2, width: '100%', height: '50px' }} value={addForm.description}
                  onChange={e => setAddForm({ ...addForm, description: e.target.value })} />
              </AField>
              <AField label="Bill Quantity *">
                <input type="number" min="1" style={styles.bulkSelect2} value={addForm.billQuantity} required
                  onChange={e => setAddForm({ ...addForm, billQuantity: e.target.value })} />
              </AField>
              <AField label="Unit">
                <input style={styles.bulkSelect2} value={addForm.unit}
                  onChange={e => setAddForm({ ...addForm, unit: e.target.value })} />
              </AField>
              <AField label="Unit Price *">
                <input type="number" min="0" step="0.01" style={styles.bulkSelect2} value={addForm.unitPrice} required
                  onChange={e => setAddForm({ ...addForm, unitPrice: e.target.value })} />
              </AField>
              <AField label="GST %">
                <input type="number" min="0" step="0.01" style={styles.bulkSelect2} value={addForm.gstPercent}
                  onChange={e => setAddForm({ ...addForm, gstPercent: e.target.value })} />
              </AField>
              <AField label="Vendor / Party Name *">
                <input style={styles.bulkSelect2} list="add-vendor-list" value={addForm.vendorName} required
                  onChange={e => setAddForm({ ...addForm, vendorName: e.target.value })} />
                <datalist id="add-vendor-list">
                  {addLookups.vendors.map(v => <option key={v.id} value={v.name} />)}
                </datalist>
              </AField>
              <AField label="Invoice Number *">
                <input style={styles.bulkSelect2} value={addForm.invoiceNumber} required
                  onChange={e => setAddForm({ ...addForm, invoiceNumber: e.target.value })} />
              </AField>
              <AField label="Invoice Date *">
                <input type="date" style={styles.bulkSelect2} value={addForm.invoiceDate} required
                  onChange={e => setAddForm({ ...addForm, invoiceDate: e.target.value })} />
              </AField>
              <ProgramSelect
                programs={addLookups.projects} mode="name" label="Program Name" required
                value={addForm.projectName} otherValue={otherAddProjectName}
                onChange={value => setAddForm({ ...addForm, projectName: value })}
                onOtherChange={setOtherAddProjectName}
              />
              <AField label="Business Head / Department *">
                <select style={styles.bulkSelect2} value={addForm.businessHeadName} required
                  onChange={e => setAddForm({ ...addForm, businessHeadName: e.target.value })}>
                  <option value="">Select...</option>
                  {addLookups.businessHeads.filter(b => b.name !== 'Unspecified').map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </AField>
              <AField label="Purchased For">
                <input style={styles.bulkSelect2} value={addForm.purchasedFor}
                  onChange={e => setAddForm({ ...addForm, purchasedFor: e.target.value })} />
              </AField>
              <div style={{ gridColumn: '1 / -1' }}>
                <PhotoInput label="Photo (optional)" value={addForm.image} onChange={value => setAddForm({ ...addForm, image: value })} onUploadStateChange={setPhotoUploading} />
              </div>
              <AField label={addForm.isBulk
                ? 'Batch / Lot Reference (optional, one value applied to all units)'
                : 'Serial Numbers (comma/newline separated — required for critical electronics)'} fullWidth>
                <label style={styles.bulkCheckboxRow}>
                  <input type="checkbox" checked={addForm.isBulk} onChange={e => setAddForm({ ...addForm, isBulk: e.target.checked })} />
                  <span>Bulk item — one shared reference for the whole quantity (skip individual serials)</span>
                </label>
                <textarea style={{ ...styles.bulkSelect2, width: '100%', height: '50px' }} value={addForm.serialNumbersText}
                  onChange={e => setAddForm({ ...addForm, serialNumbersText: e.target.value })} />
              </AField>
              <AField label="Warranty">
                <label style={styles.bulkCheckboxRow}>
                  <input type="checkbox" checked={addForm.hasWarranty} onChange={e => setAddForm({ ...addForm, hasWarranty: e.target.checked })} />
                  <span>This batch has a warranty</span>
                </label>
                {addForm.hasWarranty && (
                  <input type="date" style={styles.bulkSelect2} value={addForm.warrantyUntil} required
                    onChange={e => setAddForm({ ...addForm, warrantyUntil: e.target.value })} />
                )}
              </AField>

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button type="button" style={styles.addBtnSecondary} onClick={() => setAddModalOpen(false)}>Cancel</button>
                <button type="submit" style={styles.addBtn} disabled={addSaving || photoUploading}>
                  {addSaving ? 'Saving...' : photoUploading ? 'Uploading photo...' : 'Add Component'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {internalUseOpen && (
        <div style={styles.overlay} onClick={() => !internalUseSaving && setInternalUseOpen(false)}>
          <div style={{ ...styles.drawer, maxWidth: '560px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div>
                <h3 style={styles.modalTitle}>Internal Use</h3>
                <p style={styles.sub}>Components pulled for a session or internal project -- stock reduces immediately.</p>
              </div>
              <button style={styles.closeBtn} onClick={() => setInternalUseOpen(false)} disabled={internalUseSaving}>X</button>
            </div>
            {internalUseMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{internalUseMsg}</div>}
            <form onSubmit={handleInternalUseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <AField label="Who is taking the components">
                <input style={styles.bulkSelect2} value={internalUseForm.takenBy}
                  onChange={e => setInternalUseForm({ ...internalUseForm, takenBy: e.target.value })} required />
              </AField>
              <ProgramSelect
                programs={internalUsePrograms} mode="id" label="Program" required
                value={internalUseForm.projectId} otherValue={internalUseForm.otherProgramName}
                onChange={value => setInternalUseForm({ ...internalUseForm, projectId: value })}
                onOtherChange={value => setInternalUseForm({ ...internalUseForm, otherProgramName: value })}
              />
              <AField label="Reason">
                <textarea style={{ ...styles.bulkSelect2, height: '50px' }} value={internalUseForm.reason}
                  onChange={e => setInternalUseForm({ ...internalUseForm, reason: e.target.value })}
                  placeholder="e.g. Workshop demo, internal prototype build" />
              </AField>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginTop: '-4px' }}>
                If this is for a workshop/session with visiting students, optionally fill in:
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <AField label="Number of Students">
                  <input type="number" min="0" style={styles.bulkSelect2} value={internalUseForm.studentCount}
                    onChange={e => setInternalUseForm({ ...internalUseForm, studentCount: e.target.value })} />
                </AField>
                <AField label="Number of Teams">
                  <input type="number" min="0" style={styles.bulkSelect2} value={internalUseForm.teamCount}
                    onChange={e => setInternalUseForm({ ...internalUseForm, teamCount: e.target.value })} />
                </AField>
                <AField label="Institute Name">
                  <input style={styles.bulkSelect2} value={internalUseForm.instituteName}
                    onChange={e => setInternalUseForm({ ...internalUseForm, instituteName: e.target.value })} />
                </AField>
              </div>
              <AField label="Components">
                <datalist id="internal-use-catalog-options">
                  {items.map(item => <option key={item.catalog_id} value={item.name} />)}
                </datalist>
                {internalUseRows.map((row, index) => (
                  <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input style={{ ...styles.bulkSelect2, flex: 2 }} list="internal-use-catalog-options"
                      placeholder="Start typing a component name..." value={row.name}
                      onChange={e => updateInternalUseRow(index, 'name', e.target.value)} />
                    <input style={{ ...styles.bulkSelect2, flex: 1 }} type="number" min="1" placeholder="Qty"
                      value={row.qty} onChange={e => updateInternalUseRow(index, 'qty', e.target.value)} />
                    {internalUseRows.length > 1 && (
                      <button type="button" style={styles.docDeleteBtn} onClick={() => removeInternalUseRow(index)}>Remove</button>
                    )}
                  </div>
                ))}
                <button type="button" style={styles.addBtnSecondary} onClick={addInternalUseRow}>+ Add another component</button>
              </AField>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" style={styles.addBtnSecondary} onClick={() => setInternalUseOpen(false)} disabled={internalUseSaving}>Cancel</button>
                <button type="submit" style={styles.addBtn} disabled={internalUseSaving}>
                  {internalUseSaving ? 'Saving...' : 'Record Internal Use'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {returnListOpen && (
        <div style={styles.overlay} onClick={() => !returnSaving && setReturnListOpen(false)}>
          <div style={{ ...styles.drawer, maxWidth: '560px', ...(isMobile ? styles.drawerMobile : {}) }} onClick={event => event.stopPropagation()}>
            {!returningIssue ? (
              <>
                <div style={styles.drawerHeader}>
                  <h3 style={styles.modalTitle}>Return Internal Use</h3>
                  <button style={styles.closeBtn} onClick={() => setReturnListOpen(false)}>X</button>
                </div>
                {returnMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{returnMsg}</div>}
                {returnLoading ? (
                  <div style={styles.loading}>Loading...</div>
                ) : openInternalIssues.length === 0 ? (
                  <p style={styles.sub}>Nothing currently outstanding for this center.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {openInternalIssues.map(issue => (
                      <button key={issue.id} type="button" style={{ ...styles.docRow, cursor: 'pointer', textAlign: 'left' }} onClick={() => openReturnEntry(issue)}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '13px' }}>{issue.issueCode} · {issue.takenBy}</div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>{issue.reason} · {issue.status}</div>
                          {(issue.studentCount != null || issue.teamCount != null || issue.instituteName) && (
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                              {[issue.studentCount != null && `${issue.studentCount} student${issue.studentCount === 1 ? '' : 's'}`,
                                issue.teamCount != null && `${issue.teamCount} team${issue.teamCount === 1 ? '' : 's'}`,
                                issue.instituteName].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={styles.drawerHeader}>
                  <div>
                    <h3 style={styles.modalTitle}>{returningIssue.issueCode}</h3>
                    <p style={styles.sub}>Taken by {returningIssue.takenBy} -- {returningIssue.reason}</p>
                  </div>
                  <button style={styles.closeBtn} onClick={() => setReturningIssue(null)} disabled={returnSaving}>X</button>
                </div>
                {returnMsg && <div style={{ ...styles.actionMsg, ...styles.actionMsgError }}>{returnMsg}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {returningIssue.items.filter(item => item.outstandingQty > 0).map(item => (
                    <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>{item.name} -- {item.outstandingQty} outstanding</div>
                      {Array.isArray(item.assets) && item.assets.filter(a => a.status === 'issued').length > 0 && (
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>
                          Not the right physical unit?{' '}
                          {item.assets.filter(a => a.status === 'issued').map(a => (
                            <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', marginRight: '10px' }}>
                              {a.assetTag}{a.serialNumber ? ` (SN: ${a.serialNumber})` : ''}
                              <AssetSwapPicker
                                asset={a}
                                catalogId={item.catalogId}
                                swapUrl={`/api/internal-issues/${returningIssue.id}/items/${item.id}/swap-asset`}
                                onSwapped={refreshReturningIssue}
                              />
                            </span>
                          ))}
                        </div>
                      )}
                      <AssetConditionPicker
                        assets={returnAssetForm[item.id] || []}
                        onChange={(assetId, condition) => setReturnAssetCondition(item.id, assetId, condition)}
                      />
                    </div>
                  ))}
                </div>
                {Object.values(returnAssetForm).some(assets => assets.some(a => a.condition === 'damaged')) && (
                  <AField label="Reason for the damaged unit(s) (required)">
                    <input style={styles.bulkSelect2} value={returnDamageReason}
                      onChange={e => setReturnDamageReason(e.target.value)}
                      placeholder="What happened to it?" />
                  </AField>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                  <button type="button" style={styles.addBtnSecondary} onClick={() => setReturningIssue(null)} disabled={returnSaving}>Back</button>
                  <button type="button" style={styles.addBtn} disabled={returnSaving} onClick={handleReturnSubmit}>
                    {returnSaving ? 'Saving...' : 'Record Return'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AField({ label, children, fullWidth }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>{label}</label>
      {children}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f0f2f8', padding: '32px 24px' },
  pageMobile: { padding: '22px 14px 28px' },
  container: { maxWidth: '1400px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' },
  centerRow: { marginBottom: '16px' },
  centerSelect: { minWidth: '280px', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #dbe3f0', fontSize: '14px', background: '#fff' },
  title: { fontFamily: "'DM Sans', sans-serif", fontSize: '24px', fontWeight: 800, color: '#1a1a2e' },
  sub: { color: '#6b7280', fontSize: '13px', marginTop: '4px' },
  addBtn: { background: 'linear-gradient(135deg, #ff6d00, #ff9a3c)', color: '#fff', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' },
  addBtnSecondary: { background: '#e8eaf6', color: '#1a237e', border: 'none', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' },
  deleteBtn: { background: '#fff', color: '#c62828', border: '1px solid #ef9a9a', padding: '11px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  toolbarStack: { alignItems: 'stretch' },
  fullWidthBtn: { width: '100%' },
  search: { flex: 1, minWidth: '260px', padding: '11px 16px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", outline: 'none', background: '#fff' },
  searchMobile: { minWidth: 0 },
  filterSelect: { minWidth: '220px', padding: '11px 12px', border: '1.5px solid #dbe3f0', borderRadius: '10px', fontSize: '14px', background: '#fff', color: '#1f2937' },
  downloadInventoryBtn: { background: '#e0f2f1', color: '#00695c', border: '1.5px solid #b2dfdb', padding: '10px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '13px', whiteSpace: 'nowrap' },
  loading: { padding: '60px', textAlign: 'center', color: '#6b7280' },
  tableWrap: { background: '#fff', borderRadius: '14px', overflowX: 'auto', overflowY: 'hidden', boxShadow: '0 2px 12px rgba(26,35,126,0.07)' },
  // A sticky <th> needs an ancestor that actually establishes a bounded,
  // independently-scrolling box for it to stick within -- an unbounded div
  // (grows to fit content, never scrolls on its own) doesn't give sticky
  // anything to "stick" inside, it just renders as if non-sticky. And once
  // overflowX is 'auto' here (for narrow-viewport horizontal scroll), the
  // CSS overflow spec forces overflowY to also compute as 'auto' even if
  // left as 'visible' -- so this box unavoidably becomes the sticky
  // positioning context either way; the fix is to give it a real height so
  // that context actually does something, rather than fight the spec.
  mainTableWrap: { maxHeight: '75vh', overflowY: 'auto' },
  table: { width: '100%', minWidth: '980px', borderCollapse: 'collapse' },
  thead: { background: '#1a237e' },
  // position: sticky goes on each <th> (not <thead>, which has patchy
  // support for it) -- each one needs its own opaque background since a
  // sticky cell paints above the scrolling rows beneath it.
  th: { padding: '12px 14px', color: '#fff', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'left', position: 'sticky', top: 0, zIndex: 2, background: '#1a237e' },
  thSortable: { cursor: 'pointer', userSelect: 'none' },
  thSortableActive: { color: '#ffca28' },
  sortArrow: { fontSize: '10px', opacity: 0.85 },
  tr: { borderBottom: '1px solid #f0f2f8' },
  td: { padding: '12px 14px', fontSize: '13px', color: '#374151', verticalAlign: 'middle' },
  thumb: { width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' },
  thumbPlaceholder: { width: '48px', height: '48px', borderRadius: '8px', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#94a3b8', textAlign: 'center' },
  compName: { fontWeight: 600, color: '#1a1a2e', fontSize: '14px' },
  lowStockTag: { color: '#c62828', fontSize: '11px', fontWeight: 700, marginTop: '2px' },
  warrantyTag: { color: '#2e7d32', fontSize: '11px', fontWeight: 700, marginTop: '2px' },
  warrantyTagExpired: { color: '#c62828', fontSize: '11px', fontWeight: 700 },
  warrantyMovedNote: { fontSize: '12px', color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', lineHeight: 1.5 },
  mergeHint: { fontSize: '11px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.4 },
  mergeHintActive: { fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px', marginTop: '6px', fontWeight: 600, lineHeight: 1.4 },
  catTag: { background: '#e8eaf6', color: '#1a237e', padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 },
  stockNum: { padding: '2px 10px', borderRadius: '10px', fontWeight: 800, fontSize: '14px', fontFamily: "'DM Sans', sans-serif" },
  damageBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '36px', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  damageBadgeWarn: { background: '#fce4ec', color: '#c62828' },
  damageBadgeOk: { background: '#f1f5f9', color: '#64748b' },
  badge: { padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: '#f1f5f9', color: '#374151' },
  damageProgramTag: { padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 700, background: '#fce4ec', color: '#c62828' },
  actions: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  viewBtn: { background: '#e8eaf6', color: '#1a237e', border: 'none', borderRadius: '7px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  editBtn: { background: '#e8eaf6', color: '#1a237e', border: 'none', borderRadius: '7px', padding: '6px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: '20px', overflowY: 'auto' },
  drawer: { background: '#fff', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '900px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', margin: '20px 0' },
  drawerMobile: { padding: '22px 18px' },
  // The units table is 10 columns wide (minWidth 980px) -- the default
  // 900px drawer forced horizontal scroll even on normal desktop widths.
  unitsDrawer: { maxWidth: 'min(1240px, 95vw)' },
  drawerHeader: { display: 'flex', alignItems: 'flex-start', marginBottom: '16px', gap: '16px' },
  drawerPhoto: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #e2e8f0', flexShrink: 0 },
  drawerPhotoPlaceholder: { width: '64px', height: '64px', borderRadius: '10px', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#94a3b8', textAlign: 'center', flexShrink: 0 },
  drawerDescription: { fontSize: '12px', color: '#475569', marginTop: '6px', maxWidth: '520px' },
  modalTitle: { fontFamily: "'DM Sans', sans-serif", fontSize: '17px', fontWeight: 700, color: '#1a1a2e' },
  closeBtn: { background: '#f0f2f8', border: 'none', borderRadius: '8px', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b7280' },
  valueBox: { display: 'flex', gap: '20px', flexWrap: 'wrap', background: '#f8fafc', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', fontSize: '13px', color: '#374151' },
  valueBoxTotal: { color: '#1a237e', fontWeight: 700 },
  actionMsg: { padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '14px', fontWeight: 600 },
  actionMsgSuccess: { background: '#e8f5e9', color: '#2e7d32' },
  actionMsgError: { background: '#fce4ec', color: '#c62828' },
  bulkBox: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', marginBottom: '16px' },
  bulkLabel: { fontSize: '12px', fontWeight: 700, color: '#374151' },
  bulkSelect: { padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #dbe3f0', fontSize: '12px', background: '#fff' },
  bulkCount: { width: '70px', padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #dbe3f0', fontSize: '12px' },
  bulkBtn: { background: '#1a237e', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' },
  addGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' },
  addGridMobile: { gridTemplateColumns: '1fr' },
  bulkSelect2: { width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1.5px solid #dbe3f0', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", background: '#fff', outline: 'none' },
  bulkCheckboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#374151', fontWeight: 600, marginBottom: '4px', cursor: 'pointer' },
};
