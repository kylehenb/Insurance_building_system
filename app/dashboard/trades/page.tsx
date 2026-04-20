'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';
import { TradesCsvImportDialog, type TradesImportRow } from './TradesCsvImportDialog';

type TradesRow = Database['public']['Tables']['trades']['Row'];
type TradesInsert = Database['public']['Tables']['trades']['Insert'];

const STATUS_OPTIONS = ['active', 'inactive'] as const;

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(value);
}

export default function TradesPage() {
  const router = useRouter();
  const [items, setItems] = useState<TradesRow[]>([]);
  const [filteredItems, setFilteredItems] = useState<TradesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<TradesRow | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<TradesRow | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<TradesInsert>>({
    primary_trade: '',
    trade_code: null,
    business_name: '',
    entity_name: null,
    abn: null,
    primary_contact: null,
    address: null,
    lat: null,
    lng: null,
    contact_email: null,
    contact_mobile: null,
    contact_office: null,
    can_do_make_safe: false,
    makesafe_priority: null,
    can_do_reports: false,
    availability: 'maintain_capacity',
    priority_rank: 3,
    gary_opt_out: false,
    gary_contact_preference: null,
    gary_notes: null,
    status: 'active',
    status_note: null,
    notes: null,
  });

  // Sort state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Column width state - load from localStorage or use defaults
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults = {
      primary_trade: 140,
      business_name: 200,
      primary_contact: 140,
      contact_mobile: 120,
      priority_rank: 100,
      availability: 120,
      can_do_make_safe: 80,
      can_do_reports: 80,
      status: 80,
      actions: 80,
    };
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trades-column-widths');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return { ...defaults, ...parsed };
        } catch (e) {
          console.error('Failed to parse saved column widths:', e);
        }
      }
    }
    return defaults;
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);

  // Save column widths to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('trades-column-widths', JSON.stringify(columnWidths));
    }
  }, [columnWidths]);

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
        .eq('preference_key', 'trades_column_widths')
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
        preference_key: 'trades_column_widths',
        preference_value: widths,
      });
  };

  // Column resize handler
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
        .from('trades')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('primary_trade', { ascending: true });
      setItems((data as TradesRow[]) ?? []);
      setLoading(false);
    }
    fetchItems();
  }, [tenantId, supabase]);

  // Filter items
  useEffect(() => {
    let filtered = items;

    // Status filter
    if (statusFilter !== 'All') {
      filtered = filtered.filter(item => item.status === statusFilter);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.primary_trade && item.primary_trade.toLowerCase().includes(query)) ||
        (item.business_name && item.business_name.toLowerCase().includes(query)) ||
        (item.primary_contact && item.primary_contact.toLowerCase().includes(query)) ||
        (item.trade_code && item.trade_code.toLowerCase().includes(query))
      );
    }

    setFilteredItems(filtered);
  }, [items, statusFilter, searchQuery]);

  // Sort items separately - only triggered by header clicks
  useEffect(() => {
    if (sortColumn) {
      const sorted = [...filteredItems].sort((a, b) => {
        let aVal: any, bVal: any;
        
        switch (sortColumn) {
          case 'primary_trade':
            aVal = a.primary_trade || '';
            bVal = b.primary_trade || '';
            break;
          case 'business_name':
            aVal = a.business_name || '';
            bVal = b.business_name || '';
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
      setFilteredItems(sorted);
    }
  }, [sortColumn, sortDirection]);

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
      primary_trade: '',
      trade_code: null,
      business_name: '',
      entity_name: null,
      abn: null,
      primary_contact: null,
      address: null,
      lat: null,
      lng: null,
      contact_email: null,
      contact_mobile: null,
      contact_office: null,
      can_do_make_safe: false,
      makesafe_priority: null,
      can_do_reports: false,
      availability: 'maintain_capacity',
      priority_rank: 3,
      gary_opt_out: false,
      gary_contact_preference: null,
      gary_notes: null,
      status: 'active',
      status_note: null,
      notes: null,
    });
    setShowModal(true);
  };

  const handleEdit = (item: TradesRow) => {
    setEditingItem(item);
    setFormData({
      primary_trade: item.primary_trade,
      trade_code: item.trade_code,
      business_name: item.business_name,
      entity_name: item.entity_name,
      abn: item.abn,
      primary_contact: item.primary_contact,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      contact_email: item.contact_email,
      contact_mobile: item.contact_mobile,
      contact_office: item.contact_office,
      can_do_make_safe: item.can_do_make_safe,
      makesafe_priority: item.makesafe_priority,
      can_do_reports: item.can_do_reports,
      availability: item.availability || 'maintain_capacity',
      priority_rank: item.priority_rank ?? 3,
      gary_opt_out: item.gary_opt_out,
      gary_contact_preference: item.gary_contact_preference,
      gary_notes: item.gary_notes,
      status: item.status,
      status_note: item.status_note,
      notes: item.notes,
    });
    setShowModal(true);
  };

  const handleDelete = (item: TradesRow) => {
    setItemToDelete(item);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete || !tenantId) return;

    await supabase.from('trades').delete().eq('id', itemToDelete.id);

    // Refresh
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as TradesRow[]) ?? []);

    setShowDeleteConfirm(false);
    setItemToDelete(null);
  };

  const handleSave = async () => {
    if (!tenantId) return;

    if (editingItem) {
      // Update existing item
      await supabase
        .from('trades')
        .update(formData as TradesInsert)
        .eq('id', editingItem.id);
    } else {
      // Insert new item
      await supabase.from('trades').insert({
        ...formData,
        tenant_id: tenantId,
      } as TradesInsert);
    }

    // Refresh
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as TradesRow[]) ?? []);

    setShowModal(false);
  };

  // CSV import handler
  const handleCsvImport = async (importedItems: TradesImportRow[]) => {
    if (!tenantId) return;

    const records = importedItems.map(item => ({
      ...item,
      tenant_id: tenantId,
    } as TradesInsert));

    await supabase.from('trades').insert(records);

    // Refresh
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('primary_trade', { ascending: true });
    setItems((data as TradesRow[]) ?? []);
  };

  // Inline edit handlers
  const handleInlineEdit = async (itemId: string, field: string, value: any) => {
    if (!tenantId) return;

    await supabase
      .from('trades')
      .update({ [field]: value } as TradesInsert)
      .eq('id', itemId);

    // Refresh
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as TradesRow[]) ?? []);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1a1a1a]">Trades</h1>
            <p className="mt-1 text-sm text-[#1a1a1a]/60">
              Manage your trade contacts and subcontractors
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
              Add Trade
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            >
              <option value="All">All Status</option>
              {STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Trade, business, contact..."
              className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            />
          </div>

          <div className="text-sm text-[#1a1a1a]/60 self-end">
            {filteredItems.length} trade{filteredItems.length !== 1 ? 's' : ''}
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
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">No trades found</h3>
              <p className="mt-2 max-w-sm text-center text-sm text-[#1a1a1a]/60">
                {items.length === 0
                  ? 'Get started by adding your first trade contact.'
                  : 'Try adjusting your filters to find what you\'re looking for.'}
              </p>
              {items.length === 0 && (
                <button
                  onClick={handleAdd}
                  className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-[#f5f0e8] hover:bg-[#1a1a1a]/90 transition-colors"
                >
                  Add First Trade
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
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.primary_trade, borderRightWidth: '0.2px' }}
                      onClick={() => handleSort('primary_trade')}
                    >
                      Primary Trade {sortColumn === 'primary_trade' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('primary_trade', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.business_name, borderRightWidth: '0.5px' }}
                      onClick={() => handleSort('business_name')}
                    >
                      Business Name {sortColumn === 'business_name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('business_name', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.primary_contact, borderRightWidth: '0.5px' }}
                    >
                      Primary Contact
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('primary_contact', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.contact_mobile, borderRightWidth: '0.5px' }}
                    >
                      Mobile
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('contact_mobile', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.priority_rank, borderRightWidth: '0.5px' }}
                    >
                      Priority
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('priority_rank', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.availability, borderRightWidth: '0.5px' }}
                    >
                      Availability
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('availability', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.can_do_make_safe, borderRightWidth: '0.5px' }}
                    >
                      Make Safe
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('can_do_make_safe', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.can_do_reports, borderRightWidth: '0.5px' }}
                    >
                      Reports
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('can_do_reports', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.status, borderRightWidth: '0.5px' }}
                    >
                      Status
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('status', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      style={{ width: columnWidths.actions }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0ece6] bg-white">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#faf9f7] transition-colors">
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.primary_trade }}>
                        <input
                          type="text"
                          defaultValue={item.primary_trade || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'primary_trade', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.business_name }}>
                        <input
                          type="text"
                          defaultValue={item.business_name || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'business_name', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.primary_contact }}>
                        <input
                          type="text"
                          defaultValue={item.primary_contact || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'primary_contact', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.contact_mobile }}>
                        <input
                          type="text"
                          defaultValue={item.contact_mobile || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'contact_mobile', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.priority_rank }}>
                        <span className="text-sm">
                          {item.priority_rank && item.priority_rank >= 1 && item.priority_rank <= 5
                            ? '⭐'.repeat(item.priority_rank)
                            : '⭐⭐⭐'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.availability }}>
                        <select
                          defaultValue={item.availability || 'maintain_capacity'}
                          onChange={(e) => handleInlineEdit(item.id, 'availability', e.target.value)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        >
                          <option value="more_capacity">More</option>
                          <option value="maintain_capacity">Maintain</option>
                          <option value="reduce_capacity">Reduce</option>
                          <option value="on_pause">Pause</option>
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.can_do_make_safe }}>
                        <input
                          type="checkbox"
                          defaultChecked={item.can_do_make_safe || false}
                          onChange={(e) => handleInlineEdit(item.id, 'can_do_make_safe', e.target.checked)}
                          className="rounded border-[#e0dbd4] text-[#c9a96e] focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.can_do_reports }}>
                        <input
                          type="checkbox"
                          defaultChecked={item.can_do_reports || false}
                          onChange={(e) => handleInlineEdit(item.id, 'can_do_reports', e.target.checked)}
                          className="rounded border-[#e0dbd4] text-[#c9a96e] focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.status }}>
                        <select
                          defaultValue={item.status || 'active'}
                          onChange={(e) => handleInlineEdit(item.id, 'status', e.target.value)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        >
                          {STATUS_OPTIONS.map(status => (
                            <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-right" style={{ width: columnWidths.actions }}>
                        <button
                          onClick={() => handleEdit(item)}
                          className="text-[#1a1a1a]/60 hover:text-[#1a1a1a] mr-2"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="text-[#1a1a1a]/60 hover:text-red-600"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit/Add Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                {editingItem ? 'Edit Trade' : 'Add Trade'}
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Primary Trade *</label>
                  <input
                    type="text"
                    value={formData.primary_trade || ''}
                    onChange={(e) => setFormData({ ...formData, primary_trade: e.target.value })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Trade Code</label>
                  <input
                    type="text"
                    value={formData.trade_code || ''}
                    onChange={(e) => setFormData({ ...formData, trade_code: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Business Name *</label>
                  <input
                    type="text"
                    value={formData.business_name || ''}
                    onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Entity Name</label>
                  <input
                    type="text"
                    value={formData.entity_name || ''}
                    onChange={(e) => setFormData({ ...formData, entity_name: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">ABN</label>
                  <input
                    type="text"
                    value={formData.abn || ''}
                    onChange={(e) => setFormData({ ...formData, abn: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Primary Contact</label>
                  <input
                    type="text"
                    value={formData.primary_contact || ''}
                    onChange={(e) => setFormData({ ...formData, primary_contact: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Address</label>
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Contact Email</label>
                  <input
                    type="email"
                    value={formData.contact_email || ''}
                    onChange={(e) => setFormData({ ...formData, contact_email: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Contact Mobile</label>
                  <input
                    type="text"
                    value={formData.contact_mobile || ''}
                    onChange={(e) => setFormData({ ...formData, contact_mobile: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Contact Office</label>
                  <input
                    type="text"
                    value={formData.contact_office || ''}
                    onChange={(e) => setFormData({ ...formData, contact_office: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Status</label>
                  <select
                    value={formData.status || 'active'}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  >
                    {STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.can_do_make_safe || false}
                      onChange={(e) => setFormData({ ...formData, can_do_make_safe: e.target.checked })}
                      className="rounded border-[#e0dbd4] text-[#c9a96e] focus:ring-[#c9a96e]/50"
                    />
                    <span className="text-xs font-medium text-[#1a1a1a]/70">Can Do Make Safe</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.can_do_reports || false}
                      onChange={(e) => setFormData({ ...formData, can_do_reports: e.target.checked })}
                      className="rounded border-[#e0dbd4] text-[#c9a96e] focus:ring-[#c9a96e]/50"
                    />
                    <span className="text-xs font-medium text-[#1a1a1a]/70">Can Do Reports</span>
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Availability</label>
                  <select
                    value={formData.availability || 'maintain_capacity'}
                    onChange={(e) => setFormData({ ...formData, availability: e.target.value as any })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  >
                    <option value="more_capacity">More Capacity</option>
                    <option value="maintain_capacity">Maintain Capacity</option>
                    <option value="reduce_capacity">Reduce Capacity</option>
                    <option value="on_pause">On Pause</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Priority Rank</label>
                  <select
                    value={formData.priority_rank ?? 3}
                    onChange={(e) => setFormData({ ...formData, priority_rank: parseInt(e.target.value) })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  >
                    <option value={1}>⭐ (1) - Lowest Priority</option>
                    <option value={2}>⭐⭐ (2) - Low Priority</option>
                    <option value={3}>⭐⭐⭐ (3) - Medium Priority</option>
                    <option value={4}>⭐⭐⭐⭐ (4) - High Priority</option>
                    <option value={5}>⭐⭐⭐⭐⭐ (5) - Highest Priority</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Notes</label>
                  <textarea
                    value={formData.notes || ''}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value || null })}
                    rows={3}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50 resize-none"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-[#3a3530] bg-white border border-[#e0dbd4] rounded-lg hover:bg-[#f5f0e8] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-medium text-[#f5f0e8] bg-[#1a1a1a] rounded-lg hover:bg-[#1a1a1a]/90 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold text-[#1a1a1a] mb-2">Delete Trade</h2>
              <p className="text-sm text-[#1a1a1a]/70 mb-6">
                Are you sure you want to delete "{itemToDelete?.business_name}"? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
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
        <TradesCsvImportDialog
          isOpen={showCsvImport}
          onClose={() => setShowCsvImport(false)}
          onImport={handleCsvImport}
        />
      </div>
    </div>
  );
}
