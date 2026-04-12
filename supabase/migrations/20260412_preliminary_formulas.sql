-- Add preliminary_formula field to scope_items for dynamic preliminary calculations
-- This field stores the formula type (e.g., 'hii', 'ctf', 'bsl', 'council', 'cdc')
-- so that preliminary items can be recalculated dynamically when the quote subtotal changes

alter table scope_items
  add column if not exists preliminary_formula text
  check (preliminary_formula in ('hii', 'ctf', 'bsl', 'council', 'cdc'));

-- Add index for efficient filtering of preliminary items
create index if not exists idx_scope_items_preliminary_formula
  on scope_items(preliminary_formula)
  where preliminary_formula is not null;
