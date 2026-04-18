'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';
import { ScopeLibraryCsvImportDialog, type ScopeLibraryImportRow } from './ScopeLibraryCsvImportDialog';

type ScopeLibraryRow = Database['public']['Tables']['scope_library']['Row'];
type ScopeLibraryInsert = Database['public']['Tables']['scope_library']['Insert'];

// Extended type to include new fields from spec that may not be in database.types yet
type ScopeLibraryExtended = ScopeLibraryInsert & {
  has_lag?: boolean;
  lag_days?: number | null;
  lag_description?: string | null;
  approval_status?: 'pending' | 'approved';
};

// Units from quote editor
const UNITS = ['m²', 'm³', 'lm', 'ea', 'hr', 'item', 'set'] as const;

// Local type for scope_library_history since it may not be fully in database.types
type ScopeLibraryHistoryInsert = {
  tenant_id: string;
  scope_library_id: string;
  snapshot: any;
  changed_by: string | null;
  changed_at?: string;
};

const INSURERS = ['All', 'Default', 'Midcity', 'Sedgwick', 'A&G', 'IAG', 'RAC', 'Suncorp'];

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return value.toFixed(2);
}

export default function ScopeLibraryPage() {
  const router = useRouter();
  const [items, setItems] = useState<ScopeLibraryRow[]>([]);
  const [filteredItems, setFilteredItems] = useState<ScopeLibraryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Filter state
  const [tradeFilter, setTradeFilter] = useState<string>('All');
  const [insurerFilter, setInsurerFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ScopeLibraryRow | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ScopeLibraryRow | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<ScopeLibraryExtended>>({
    insurer_specific: null,
    trade: '',
    keyword: '',
    item_description: '',
    unit: '',
    labour_rate_per_hour: null,
    labour_per_unit: null,
    materials_per_unit: null,
    total_per_unit: null,
    estimated_hours: null,
    has_lag: false,
    lag_days: null,
    lag_description: null,
    split_type: null,
    pair_id: null,
    approval_status: 'pending',
  });

  // Trades from API
  const [trades, setTrades] = useState<Array<{ id: string; primary_trade: string; trade_code: string | null }>>([]);

  // Sort state
  const [sortColumn, setSortColumn] = useState<string>('trade');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Column width state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    trade: 128,
    insurer: 100,
    keyword: 120,
    description: 500,
    unit: 80,
    labour_per_unit: 100,
    materials_per_unit: 120,
    total_per_unit: 100,
    estimated_hours: 100,
    actions: 80,
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Auth bootstrap
  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return }
      const { data: profile, error } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single();
      if (error || !profile) { router.push('/login'); return }
      setTenantId(profile.tenant_id);
      setUserId(user.id);
    }
    bootstrap();
  }, [router, supabase]);

  // Load column widths from database
  useEffect(() => {
    if (!tenantId || !userId) return;
    async function loadColumnWidths() {
      const { data } = await supabase
        .from('user_preferences')
        .select('preference_value')
        .eq('tenant_id', tenantId!)
        .eq('user_id', userId!)
        .eq('preference_key', 'scope_library_column_widths')
        .single();
      if (data?.preference_value) {
        setColumnWidths(data.preference_value as Record<string, number>);
      }
    }
    loadColumnWidths();
  }, [tenantId, userId, supabase]);

  // Save column widths to database
  const saveColumnWidths = async (widths: Record<string, number>) => {
    if (!tenantId || !userId) return;
    await supabase
      .from('user_preferences')
      .upsert({
        tenant_id: tenantId!,
        user_id: userId!,
        preference_key: 'scope_library_column_widths',
        preference_value: widths,
      });
  };

  // Column resize handler - uses closure to track initial position reliably
  const handleResizeStart = (column: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = columnWidths[column];

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setResizingColumn(column);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [column]: newWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setResizingColumn(null);
      setColumnWidths(prev => {
        saveColumnWidths(prev);
        return prev;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    if (!tenantId) return;
    async function fetchItems() {
      const { data } = await supabase
        .from('scope_library')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('trade', { ascending: true });
      setItems((data as ScopeLibraryRow[]) ?? []);
      setLoading(false);
    }
    fetchItems();
  }, [tenantId, supabase]);

  // Fetch trades
  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/trades?tenantId=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then((data: Array<{ id: string; primary_trade: string; trade_code: string | null }>) => {
        setTrades(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, [tenantId]);

  // Get unique trades from items
  const uniqueTrades = Array.from(
    new Set(items.map(item => item.trade).filter((t): t is string => Boolean(t)))
  ).sort();

  // Filter items
  useEffect(() => {
    let filtered = items;

    // Trade filter
    if (tradeFilter !== 'All') {
      filtered = filtered.filter(item => item.trade === tradeFilter);
    }

    // Insurer filter
    if (insurerFilter === 'Default') {
      filtered = filtered.filter(item => item.insurer_specific === null);
    } else if (insurerFilter !== 'All') {
      filtered = filtered.filter(item => item.insurer_specific === insurerFilter);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.keyword && item.keyword.toLowerCase().includes(query)) ||
        (item.item_description && item.item_description.toLowerCase().includes(query))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortColumn) {
        case 'trade':
          aVal = a.trade || '';
          bVal = b.trade || '';
          break;
        case 'keyword':
          aVal = a.keyword || '';
          bVal = b.keyword || '';
          break;
        case 'total_per_unit':
          aVal = a.total_per_unit || 0;
          bVal = b.total_per_unit || 0;
          break;
        case 'estimated_hours':
          aVal = a.estimated_hours || 0;
          bVal = b.estimated_hours || 0;
          break;
        default:
          return 0;
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    setFilteredItems(filtered);
  }, [items, tradeFilter, insurerFilter, searchQuery, sortColumn, sortDirection]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    setFormData({
      insurer_specific: null,
      trade: '',
      keyword: '',
      item_description: '',
      unit: '',
      labour_rate_per_hour: null,
      labour_per_unit: null,
      materials_per_unit: null,
      total_per_unit: null,
      estimated_hours: null,
      has_lag: false,
      lag_days: null,
      lag_description: null,
      split_type: null,
      pair_id: null,
      approval_status: 'pending',
    });
    setShowModal(true);
  };

  const handleEdit = (item: ScopeLibraryRow) => {
    setEditingItem(item);
    setFormData({
      insurer_specific: item.insurer_specific,
      trade: item.trade,
      keyword: item.keyword,
      item_description: item.item_description,
      unit: item.unit,
      labour_rate_per_hour: item.labour_rate_per_hour,
      labour_per_unit: item.labour_per_unit,
      materials_per_unit: item.materials_per_unit,
      total_per_unit: item.total_per_unit,
      estimated_hours: item.estimated_hours,
      has_lag: (item as any).has_lag || false,
      lag_days: (item as any).lag_days || null,
      lag_description: (item as any).lag_description || null,
      split_type: item.split_type,
      pair_id: item.pair_id,
      approval_status: (item as any).approval_status || 'approved',
    });
    setShowModal(true);
  };

  const handleDelete = (item: ScopeLibraryRow) => {
    setItemToDelete(item);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete || !tenantId || !userId) return;

    // Write to history before deleting
    const historyRecord: ScopeLibraryHistoryInsert = {
      tenant_id: tenantId,
      scope_library_id: itemToDelete.id,
      snapshot: itemToDelete,
      changed_by: userId,
      changed_at: new Date().toISOString(),
    };

    await supabase.from('scope_library_history').insert(historyRecord);

    // Delete the item
    await supabase.from('scope_library').delete().eq('id', itemToDelete.id);

    // Refresh
    const { data } = await supabase
      .from('scope_library')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as ScopeLibraryRow[]) ?? []);

    setShowDeleteConfirm(false);
    setItemToDelete(null);
  };

  const handleSave = async () => {
    if (!tenantId || !userId) return;

    // Omit fields not in database schema
    const { has_lag, lag_days, lag_description, ...dbFormData } = formData;

    if (editingItem) {
      // Update existing item - write to history first
      const historyRecord: ScopeLibraryHistoryInsert = {
        tenant_id: tenantId,
        scope_library_id: editingItem.id,
        snapshot: editingItem,
        changed_by: userId,
        changed_at: new Date().toISOString(),
      };

      await supabase.from('scope_library_history').insert(historyRecord);

      // Update the item
      await supabase
        .from('scope_library')
        .update({
          ...dbFormData,
          updated_at: new Date().toISOString(),
        } as ScopeLibraryInsert)
        .eq('id', editingItem.id);
    } else {
      // Insert new item
      await supabase.from('scope_library').insert({
        ...dbFormData,
        tenant_id: tenantId,
        updated_at: new Date().toISOString(),
      } as ScopeLibraryInsert);
    }

    // Refresh
    const { data } = await supabase
      .from('scope_library')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as ScopeLibraryRow[]) ?? []);

    setShowModal(false);
  };

  // CSV import handler
  const handleCsvImport = async (importedItems: ScopeLibraryImportRow[]) => {
    if (!tenantId) return;

    const records = importedItems.map(item => ({
      ...item,
      tenant_id: tenantId,
      updated_at: new Date().toISOString(),
    } as ScopeLibraryInsert));

    await supabase.from('scope_library').insert(records);

    // Refresh
    const { data } = await supabase
      .from('scope_library')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('trade', { ascending: true });
    setItems((data as ScopeLibraryRow[]) ?? []);
  };

  // Inline edit handlers
  const handleInlineEdit = async (itemId: string, field: string, value: any) => {
    if (!tenantId || !userId) return;

    const item = items.find(i => i.id === itemId);
    if (!item) return;

    // Write to history first
    const historyRecord: ScopeLibraryHistoryInsert = {
      tenant_id: tenantId,
      scope_library_id: itemId,
      snapshot: item,
      changed_by: userId,
      changed_at: new Date().toISOString(),
    };

    await supabase.from('scope_library_history').insert(historyRecord);

    // Update the item
    await supabase
      .from('scope_library')
      .update({ [field]: value, updated_at: new Date().toISOString() } as ScopeLibraryInsert)
      .eq('id', itemId);

    // Refresh
    const { data } = await supabase
      .from('scope_library')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as ScopeLibraryRow[]) ?? []);
  };

  // Approve/Unapprove handler
  const handleToggleApproval = async (itemId: string, currentStatus: string | null) => {
    const newStatus = currentStatus === 'approved' ? 'pending' : 'approved';
    await handleInlineEdit(itemId, 'approval_status', newStatus);
  };

  // Auto-calculate total_per_unit when labour_per_unit or materials_per_unit changes
  useEffect(() => {
    if (formData.labour_per_unit !== null || formData.materials_per_unit !== null) {
      const labour = formData.labour_per_unit || 0;
      const materials = formData.materials_per_unit || 0;
      setFormData(prev => ({
        ...prev,
        total_per_unit: labour + materials,
      }));
    }
  }, [formData.labour_per_unit, formData.materials_per_unit]);

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1a1a1a]">Scope Library</h1>
            <p className="mt-1 text-sm text-[#1a1a1a]/60">
              Manage your standard scope items and pricing
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCsvImport(true)}
              className="inline-flex items-center justify-center rounded-lg border border-[#e0dbd4] bg-white px-4 py-2 text-sm font-medium text-[#3a3530] hover:bg-[#f5f0e8] transition-colors"
            >
              Import CSV
            </button>
            <button
              onClick={handleAdd}
              className="inline-flex items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-[#f5f0e8] hover:bg-[#1a1a1a]/90 transition-colors"
            >
              Add Item
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Trade</label>
            <select
              value={tradeFilter}
              onChange={(e) => setTradeFilter(e.target.value)}
              className="rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            >
              <option value="All">All Trades</option>
              {uniqueTrades.map(trade => (
                <option key={trade} value={trade}>{trade}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Insurer</label>
            <select
              value={insurerFilter}
              onChange={(e) => setInsurerFilter(e.target.value)}
              className="rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            >
              {INSURERS.map(insurer => (
                <option key={insurer} value={insurer}>{insurer}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Keyword or description..."
              className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            />
          </div>

          <div className="text-sm text-[#1a1a1a]/60 self-end">
            {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Table */}
        <div className="mt-4 rounded-lg border border-[#e4dfd8] bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-sm text-[#b0a898]">Loading...</div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f5f0e8]">
                <svg
                  className="h-8 w-8 text-[#1a1a1a]/40"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">No scope items found</h3>
              <p className="mt-2 max-w-sm text-center text-sm text-[#1a1a1a]/60">
                {items.length === 0
                  ? 'Get started by adding your first scope item to the library.'
                  : 'Try adjusting your filters to find what you\'re looking for.'}
              </p>
              {items.length === 0 && (
                <button
                  onClick={handleAdd}
                  className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-[#f5f0e8] hover:bg-[#1a1a1a]/90 transition-colors"
                >
                  Add First Item
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-[#f0ece6]" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-[#fdfdfc]">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.trade }}
                      onClick={() => handleSort('trade')}
                    >
                      Trade {sortColumn === 'trade' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('trade', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.insurer }}
                    >
                      Insurer
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('insurer', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.keyword }}
                    >
                      Keyword
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('keyword', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.description }}
                    >
                      Description
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('description', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.unit }}
                    >
                      Unit
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('unit', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.labour_per_unit }}
                    >
                      Labour/Unit
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('labour_per_unit', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.materials_per_unit }}
                    >
                      Materials/Unit
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('materials_per_unit', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.total_per_unit }}
                      onClick={() => handleSort('total_per_unit')}
                    >
                      Total/Unit {sortColumn === 'total_per_unit' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('total_per_unit', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.estimated_hours }}
                      onClick={() => handleSort('estimated_hours')}
                    >
                      Est. Hours {sortColumn === 'estimated_hours' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 4, height: '100%', cursor: 'col-resize', backgroundColor: '#d4d0ca' }}
                        onMouseDown={(e) => handleResizeStart('estimated_hours', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      style={{ width: columnWidths.actions }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0ece6] bg-white">
                  {filteredItems.map((item) => {
                    const isDraft = (item as any).approval_status !== 'approved';
                    return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-[#faf9f7] transition-colors ${isDraft ? 'bg-[#fff7ed]' : ''}`}
                    >
                      <td className="whitespace-nowrap px-3 py-3 relative" style={{ width: columnWidths.trade }}>
                        {isDraft && (
                          <div 
                            className="absolute left-0 top-0 bottom-0 flex items-center justify-center px-1 z-10"
                            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', fontSize: '9px', fontWeight: 700, letterSpacing: '1px', color: '#d97706' }}
                          >
                            DRAFT
                          </div>
                        )}
                        <select
                          value={item.trade || ''}
                          onChange={(e) => handleInlineEdit(item.id, 'trade', e.target.value || null)}
                          className={`w-full rounded border border-[#e0dbd4] bg-white px-2 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50 ${isDraft ? 'pl-8' : ''}`}
                        >
                          <option value="">—</option>
                          {trades.map((t: { id: string; primary_trade: string; trade_code: string | null }) => (
                            <option key={t.id} value={t.primary_trade}>
                              {t.trade_code ? `${t.trade_code} – ${t.primary_trade}` : t.primary_trade}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3" style={{ width: columnWidths.insurer }}>
                        <span className="text-xs text-[#1a1a1a]/70">
                          {item.insurer_specific || 'Default'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3" style={{ width: columnWidths.keyword }}>
                        <span className="text-xs font-mono text-[#1a1a1a]">
                          {item.keyword || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3" style={{ width: columnWidths.description }}>
                        <textarea
                          defaultValue={item.item_description || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'item_description', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-2 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50 resize-none"
                          rows={2}
                          style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3" style={{ width: columnWidths.unit }}>
                        <select
                          value={item.unit || ''}
                          onChange={(e) => handleInlineEdit(item.id, 'unit', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-2 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        >
                          <option value="">—</option>
                          {UNITS.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right" style={{ width: columnWidths.labour_per_unit }}>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={item.labour_per_unit || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'labour_per_unit', e.target.value ? parseFloat(e.target.value) : null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-2 py-1 text-xs text-right font-mono text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right" style={{ width: columnWidths.materials_per_unit }}>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={item.materials_per_unit || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'materials_per_unit', e.target.value ? parseFloat(e.target.value) : null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-2 py-1 text-xs text-right font-mono text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right" style={{ width: columnWidths.total_per_unit }}>
                        <span className="text-xs font-mono font-semibold text-[#1a1a1a]">
                          {formatCurrency(item.total_per_unit)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right" style={{ width: columnWidths.estimated_hours }}>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={item.estimated_hours || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'estimated_hours', e.target.value ? parseFloat(e.target.value) : null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-2 py-1 text-xs text-right font-mono text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right" style={{ width: columnWidths.actions }}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleDelete(item)}
                            className="text-[#1a1a1a]/60 hover:text-red-600 transition-colors"
                            title="Delete"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
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
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              width: '90%',
              maxWidth: 600,
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 24,
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#1a1a1a' }}>
              {editingItem ? 'Edit Scope Item' : 'Add Scope Item'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Insurer Specific
                </label>
                <select
                  value={formData.insurer_specific ?? 'Default'}
                  onChange={(e) => setFormData({
                    ...formData,
                    insurer_specific: e.target.value === 'Default' ? null : e.target.value
                  })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                >
                  <option value="Default">Default</option>
                  {INSURERS.filter(i => i !== 'All' && i !== 'Default').map(insurer => (
                    <option key={insurer} value={insurer}>{insurer}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Trade
                </label>
                <select
                  value={formData.trade || ''}
                  onChange={(e) => setFormData({ ...formData, trade: e.target.value })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                >
                  <option value="">—</option>
                  {trades.map((t: { id: string; primary_trade: string; trade_code: string | null }) => (
                    <option key={t.id} value={t.primary_trade}>
                      {t.trade_code ? `${t.trade_code} – ${t.primary_trade}` : t.primary_trade}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Keyword
                </label>
                <input
                  type="text"
                  value={formData.keyword || ''}
                  onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Item Description
                </label>
                <textarea
                  rows={3}
                  value={formData.item_description || ''}
                  onChange={(e) => setFormData({ ...formData, item_description: e.target.value })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                />
                <p className="mt-1 text-xs text-[#1a1a1a]/50">
                  Use [{`{QTY}`}] as a placeholder where quantity should appear.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Unit
                </label>
                <select
                  value={formData.unit || ''}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                >
                  <option value="">—</option>
                  {UNITS.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                    Labour Rate /Hr
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.labour_rate_per_hour || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      labour_rate_per_hour: e.target.value ? parseFloat(e.target.value) : null
                    })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                    Labour /Unit
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.labour_per_unit || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      labour_per_unit: e.target.value ? parseFloat(e.target.value) : null
                    })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                    Materials /Unit
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.materials_per_unit || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      materials_per_unit: e.target.value ? parseFloat(e.target.value) : null
                    })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                    Total /Unit
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_per_unit || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      total_per_unit: e.target.value ? parseFloat(e.target.value) : null
                    })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Estimated Hours
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.estimated_hours || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    estimated_hours: e.target.value ? parseFloat(e.target.value) : null
                  })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                  Approval Status
                </label>
                <select
                  value={formData.approval_status || 'pending'}
                  onChange={(e) => setFormData({ ...formData, approval_status: e.target.value as 'pending' | 'approved' })}
                  className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                >
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.has_lag || false}
                    onChange={(e) => setFormData({ ...formData, has_lag: e.target.checked })}
                    className="rounded border-[#e0dbd4]"
                  />
                  <span className="text-xs font-medium text-[#1a1a1a]/70">Has Lag</span>
                </label>
              </div>

              {formData.has_lag && (
                <div className="space-y-4 pl-4 border-l-2 border-[#e0dbd4]">
                  <div>
                    <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                      Lag Days
                    </label>
                    <input
                      type="number"
                      value={formData.lag_days || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        lag_days: e.target.value ? parseInt(e.target.value) : null
                      })}
                      className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">
                      Lag Description
                    </label>
                    <input
                      type="text"
                      value={formData.lag_description || ''}
                      onChange={(e) => setFormData({ ...formData, lag_description: e.target.value })}
                      className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-[#3a3530] bg-white border border-[#e0dbd4] rounded-lg hover:bg-[#f5f0e8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium text-white bg-[#1a1a1a] rounded-lg hover:bg-[#1a1a1a]/90 transition-colors"
              >
                {editingItem ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              width: '90%',
              maxWidth: 400,
              padding: 24,
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#1a1a1a' }}>
              Delete Scope Item?
            </h2>
            <p style={{ fontSize: 14, color: '#3a3530', marginBottom: 24 }}>
              This cannot be undone.
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setItemToDelete(null);
                }}
                className="px-4 py-2 text-sm font-medium text-[#3a3530] bg-white border border-[#e0dbd4] rounded-lg hover:bg-[#f5f0e8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Dialog */}
      <ScopeLibraryCsvImportDialog
        isOpen={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        onImport={handleCsvImport}
      />
    </div>
  );
}
