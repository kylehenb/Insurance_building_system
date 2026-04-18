'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';
import { ClientsCsvImportDialog, type ClientsImportRow } from './ClientsCsvImportDialog';

type ClientsRow = Database['public']['Tables']['clients']['Row'];
type ClientsInsert = Database['public']['Tables']['clients']['Insert'];

const CLIENT_TYPE_OPTIONS = ['insurer', 'adjuster_firm', 'other'] as const;
const STATUS_OPTIONS = ['active', 'inactive'] as const;

export default function ClientsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ClientsRow[]>([]);
  const [filteredItems, setFilteredItems] = useState<ClientsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Filter state
  const [clientTypeFilter, setClientTypeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ClientsRow | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ClientsRow | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<ClientsInsert>>({
    client_type: 'insurer',
    parent_id: null,
    name: '',
    trading_name: null,
    abn: null,
    submission_email: null,
    contact_phone: null,
    address: null,
    kpi_contact_hours: 2,
    kpi_booking_hours: 24,
    kpi_visit_days: 2,
    kpi_report_days: 4,
    send_booking_confirmation: false,
    notes: null,
    status: 'active',
  });

  // Sort state
  const [sortColumn, setSortColumn] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Column width state - load from localStorage or use defaults
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('clients-column-widths');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse saved column widths:', e);
        }
      }
    }
    return {
      client_type: 120,
      name: 200,
      trading_name: 180,
      abn: 120,
      submission_email: 200,
      contact_phone: 130,
      kpi_contact_hours: 100,
      kpi_booking_hours: 100,
      kpi_visit_days: 80,
      kpi_report_days: 80,
      status: 80,
      actions: 80,
    };
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);

  // Save column widths to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('clients-column-widths', JSON.stringify(columnWidths));
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
        .eq('preference_key', 'clients_column_widths')
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
        preference_key: 'clients_column_widths',
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
        .from('clients')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('name', { ascending: true });
      setItems((data as ClientsRow[]) ?? []);
      setLoading(false);
    }
    fetchItems();
  }, [tenantId, supabase]);

  // Filter items
  useEffect(() => {
    let filtered = items;

    // Client type filter
    if (clientTypeFilter !== 'All') {
      filtered = filtered.filter(item => item.client_type === clientTypeFilter);
    }

    // Status filter
    if (statusFilter !== 'All') {
      filtered = filtered.filter(item => item.status === statusFilter);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.name && item.name.toLowerCase().includes(query)) ||
        (item.trading_name && item.trading_name.toLowerCase().includes(query)) ||
        (item.submission_email && item.submission_email.toLowerCase().includes(query)) ||
        (item.contact_phone && item.contact_phone.toLowerCase().includes(query))
      );
    }

    setFilteredItems(filtered);
  }, [items, clientTypeFilter, statusFilter, searchQuery]);

  // Sort items separately - only triggered by header clicks
  useEffect(() => {
    if (sortColumn) {
      const sorted = [...filteredItems].sort((a, b) => {
        let aVal: any, bVal: any;
        
        switch (sortColumn) {
          case 'name':
            aVal = a.name || '';
            bVal = b.name || '';
            break;
          case 'trading_name':
            aVal = a.trading_name || '';
            bVal = b.trading_name || '';
            break;
          case 'kpi_contact_hours':
            aVal = a.kpi_contact_hours || 0;
            bVal = b.kpi_contact_hours || 0;
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
      client_type: 'insurer',
      parent_id: null,
      name: '',
      trading_name: null,
      abn: null,
      submission_email: null,
      contact_phone: null,
      address: null,
      kpi_contact_hours: 2,
      kpi_booking_hours: 24,
      kpi_visit_days: 2,
      kpi_report_days: 4,
      send_booking_confirmation: false,
      notes: null,
      status: 'active',
    });
    setShowModal(true);
  };

  const handleEdit = (item: ClientsRow) => {
    setEditingItem(item);
    setFormData({
      client_type: item.client_type,
      parent_id: item.parent_id,
      name: item.name,
      trading_name: item.trading_name,
      abn: item.abn,
      submission_email: item.submission_email,
      contact_phone: item.contact_phone,
      address: item.address,
      kpi_contact_hours: item.kpi_contact_hours,
      kpi_booking_hours: item.kpi_booking_hours,
      kpi_visit_days: item.kpi_visit_days,
      kpi_report_days: item.kpi_report_days,
      send_booking_confirmation: item.send_booking_confirmation,
      notes: item.notes,
      status: item.status,
    });
    setShowModal(true);
  };

  const handleDelete = (item: ClientsRow) => {
    setItemToDelete(item);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete || !tenantId) return;

    await supabase.from('clients').delete().eq('id', itemToDelete.id);

    // Refresh
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as ClientsRow[]) ?? []);

    setShowDeleteConfirm(false);
    setItemToDelete(null);
  };

  const handleSave = async () => {
    if (!tenantId) return;

    if (editingItem) {
      // Update existing item
      await supabase
        .from('clients')
        .update(formData as ClientsInsert)
        .eq('id', editingItem.id);
    } else {
      // Insert new item
      await supabase.from('clients').insert({
        ...formData,
        tenant_id: tenantId,
      } as ClientsInsert);
    }

    // Refresh
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as ClientsRow[]) ?? []);

    setShowModal(false);
  };

  // CSV import handler
  const handleCsvImport = async (importedItems: ClientsImportRow[]) => {
    if (!tenantId) return;

    const records = importedItems.map(item => ({
      ...item,
      tenant_id: tenantId,
    } as ClientsInsert));

    await supabase.from('clients').insert(records);

    // Refresh
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    setItems((data as ClientsRow[]) ?? []);
  };

  // Inline edit handlers
  const handleInlineEdit = async (itemId: string, field: string, value: any) => {
    if (!tenantId) return;

    await supabase
      .from('clients')
      .update({ [field]: value } as ClientsInsert)
      .eq('id', itemId);

    // Refresh
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('tenant_id', tenantId);
    setItems((data as ClientsRow[]) ?? []);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1a1a1a]">Clients</h1>
            <p className="mt-1 text-sm text-[#1a1a1a]/60">
              Manage insurers, adjuster firms, and other clients
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
              Add Client
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Client Type</label>
            <select
              value={clientTypeFilter}
              onChange={(e) => setClientTypeFilter(e.target.value)}
              className="rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            >
              <option value="All">All Types</option>
              {CLIENT_TYPE_OPTIONS.map(type => (
                <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}</option>
              ))}
            </select>
          </div>

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
              placeholder="Name, trading name, email..."
              className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
            />
          </div>

          <div className="text-sm text-[#1a1a1a]/60 self-end">
            {filteredItems.length} client{filteredItems.length !== 1 ? 's' : ''}
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
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">No clients found</h3>
              <p className="mt-2 max-w-sm text-center text-sm text-[#1a1a1a]/60">
                {items.length === 0
                  ? 'Get started by adding your first client.'
                  : 'Try adjusting your filters to find what you\'re looking for.'}
              </p>
              {items.length === 0 && (
                <button
                  onClick={handleAdd}
                  className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-[#f5f0e8] hover:bg-[#1a1a1a]/90 transition-colors"
                >
                  Add First Client
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
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.client_type, borderRightWidth: '0.2px' }}
                    >
                      Type
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('client_type', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.name, borderRightWidth: '0.5px' }}
                      onClick={() => handleSort('name')}
                    >
                      Name {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('name', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.trading_name, borderRightWidth: '0.5px' }}
                      onClick={() => handleSort('trading_name')}
                    >
                      Trading Name {sortColumn === 'trading_name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('trading_name', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.abn, borderRightWidth: '0.5px' }}
                    >
                      ABN
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('abn', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.submission_email, borderRightWidth: '0.5px' }}
                    >
                      Submission Email
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('submission_email', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.contact_phone, borderRightWidth: '0.5px' }}
                    >
                      Phone
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('contact_phone', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] cursor-pointer hover:text-[#1a1a1a] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.kpi_contact_hours, borderRightWidth: '0.5px' }}
                      onClick={() => handleSort('kpi_contact_hours')}
                    >
                      Contact Hrs {sortColumn === 'kpi_contact_hours' && (sortDirection === 'asc' ? '↑' : '↓')}
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('kpi_contact_hours', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.kpi_booking_hours, borderRightWidth: '0.5px' }}
                    >
                      Booking Hrs
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('kpi_booking_hours', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.kpi_visit_days, borderRightWidth: '0.5px' }}
                    >
                      Visit Days
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('kpi_visit_days', e)}
                      />
                    </th>
                    <th
                      scope="col"
                      className="px-1.5 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[#b0a898] border-r border-[#e4dfd8]"
                      style={{ position: 'relative', width: columnWidths.kpi_report_days, borderRightWidth: '0.5px' }}
                    >
                      Report Days
                      <div
                        style={{ position: 'absolute', right: 0, top: 0, width: 2, height: '100%', cursor: 'col-resize', backgroundColor: '#f5f0e8' }}
                        onMouseDown={(e) => handleResizeStart('kpi_report_days', e)}
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
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.client_type }}>
                        <select
                          defaultValue={item.client_type || 'insurer'}
                          onChange={(e) => handleInlineEdit(item.id, 'client_type', e.target.value)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        >
                          {CLIENT_TYPE_OPTIONS.map(type => (
                            <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}</option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.name }}>
                        <input
                          type="text"
                          defaultValue={item.name || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'name', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.trading_name }}>
                        <input
                          type="text"
                          defaultValue={item.trading_name || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'trading_name', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.abn }}>
                        <input
                          type="text"
                          defaultValue={item.abn || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'abn', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.submission_email }}>
                        <input
                          type="email"
                          defaultValue={item.submission_email || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'submission_email', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3" style={{ width: columnWidths.contact_phone }}>
                        <input
                          type="text"
                          defaultValue={item.contact_phone || ''}
                          onBlur={(e) => handleInlineEdit(item.id, 'contact_phone', e.target.value || null)}
                          className="w-full rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.kpi_contact_hours }}>
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={item.kpi_contact_hours || 2}
                          onBlur={(e) => handleInlineEdit(item.id, 'kpi_contact_hours', e.target.value ? parseFloat(e.target.value) : 2)}
                          className="w-16 rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] text-center focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.kpi_booking_hours }}>
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={item.kpi_booking_hours || 24}
                          onBlur={(e) => handleInlineEdit(item.id, 'kpi_booking_hours', e.target.value ? parseFloat(e.target.value) : 24)}
                          className="w-16 rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] text-center focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.kpi_visit_days }}>
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={item.kpi_visit_days || 2}
                          onBlur={(e) => handleInlineEdit(item.id, 'kpi_visit_days', e.target.value ? parseFloat(e.target.value) : 2)}
                          className="w-16 rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] text-center focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                        />
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-3 text-center" style={{ width: columnWidths.kpi_report_days }}>
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={item.kpi_report_days || 4}
                          onBlur={(e) => handleInlineEdit(item.id, 'kpi_report_days', e.target.value ? parseFloat(e.target.value) : 4)}
                          className="w-16 rounded border border-[#e0dbd4] bg-white px-1.5 py-1 text-xs text-[#1a1a1a] text-center focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
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
                {editingItem ? 'Edit Client' : 'Add Client'}
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Client Type *</label>
                  <select
                    value={formData.client_type || 'insurer'}
                    onChange={(e) => setFormData({ ...formData, client_type: e.target.value as any })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  >
                    {CLIENT_TYPE_OPTIONS.map(type => (
                      <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
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
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Name *</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Trading Name</label>
                  <input
                    type="text"
                    value={formData.trading_name || ''}
                    onChange={(e) => setFormData({ ...formData, trading_name: e.target.value || null })}
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
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Submission Email</label>
                  <input
                    type="email"
                    value={formData.submission_email || ''}
                    onChange={(e) => setFormData({ ...formData, submission_email: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    value={formData.contact_phone || ''}
                    onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">Address</label>
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value || null })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">KPI Contact Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.kpi_contact_hours || 2}
                    onChange={(e) => setFormData({ ...formData, kpi_contact_hours: e.target.value ? parseFloat(e.target.value) : 2 })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">KPI Booking Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.kpi_booking_hours || 24}
                    onChange={(e) => setFormData({ ...formData, kpi_booking_hours: e.target.value ? parseFloat(e.target.value) : 24 })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">KPI Visit Days</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.kpi_visit_days || 2}
                    onChange={(e) => setFormData({ ...formData, kpi_visit_days: e.target.value ? parseFloat(e.target.value) : 2 })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1a1a1a]/70 mb-1">KPI Report Days</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.kpi_report_days || 4}
                    onChange={(e) => setFormData({ ...formData, kpi_report_days: e.target.value ? parseFloat(e.target.value) : 4 })}
                    className="w-full rounded-md border border-[#e0dbd4] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/50"
                  />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.send_booking_confirmation || false}
                      onChange={(e) => setFormData({ ...formData, send_booking_confirmation: e.target.checked })}
                      className="rounded border-[#e0dbd4] text-[#c9a96e] focus:ring-[#c9a96e]/50"
                    />
                    <span className="text-xs font-medium text-[#1a1a1a]/70">Send Booking Confirmation</span>
                  </label>
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
              <h2 className="text-lg font-semibold text-[#1a1a1a] mb-2">Delete Client</h2>
              <p className="text-sm text-[#1a1a1a]/70 mb-6">
                Are you sure you want to delete "{itemToDelete?.name}"? This action cannot be undone.
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
        <ClientsCsvImportDialog
          isOpen={showCsvImport}
          onClose={() => setShowCsvImport(false)}
          onImport={handleCsvImport}
        />
      </div>
    </div>
  );
}
