import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Hardcoded tenant ID - user will fill in before running
const TENANT_ID = '7da695eb-63ef-476b-81dd-c81094e80f89';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables:');
  if (!SUPABASE_URL) console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface CSVRow {
  insurer_specific: string;
  trade: string;
  keyword: string;
  item_description: string;
  unit: string;
  labour_rate_per_hour: string;
  labour_per_unit: string;
  materials_per_unit: string;
  total_per_unit: string;
  estimated_hours: string;
  date_last_updated: string;
}

function parseCSV(content: string): CSVRow[] {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < headers.length) continue;

    const row: any = {};
    headers.forEach((header, index) => {
      row[header.toLowerCase().replace(/\s+/g, '_').replace('/', '_')] = values[index]?.trim() || '';
    });
    rows.push(row);
  }

  return rows;
}

function parseCurrency(value: string): number | null {
  if (!value || value.trim() === '' || value === '#DIV/0!') {
    return null;
  }
  // Remove $ and commas
  const cleaned = value.replace(/[$,]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function parseInsurerSpecific(value: string): string | null {
  if (!value || value.trim() === '' || value.trim().toLowerCase() === 'default') {
    return null;
  }
  return value.trim();
}

function isHeaderRow(row: CSVRow): boolean {
  // Skip rows where both item_description and keyword are blank (hourly rate header rows)
  const descBlank = !row.item_description || row.item_description.trim() === '';
  const keywordBlank = !row.keyword || row.keyword.trim() === '';
  return descBlank && keywordBlank;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrateScopeLibrary() {
  const csvPath = path.join(__dirname, 'data', 'scope-library.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(csvContent);

  console.log(`Parsed ${rows.length} rows from CSV`);

  const dryRun = process.env.DRY_RUN === 'true';
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made to the database');
  }

  let skipped = 0;
  let inserted = 0;
  let errors: { row: CSVRow; error: string }[] = [];

  const validInsurers = ['Midcity', 'Sedgwick', 'A&G', 'IAG', 'RAC', 'Suncorp'];

  for (const row of rows) {
    // Skip header rows
    if (isHeaderRow(row)) {
      skipped++;
      continue;
    }

    // Validate insurer_specific if present
    const insurerValue = parseInsurerSpecific(row.insurer_specific);
    if (insurerValue && !validInsurers.includes(insurerValue)) {
      console.warn(`Unknown insurer value: "${insurerValue}" - treating as-is`);
    }

    const insertData = {
      tenant_id: TENANT_ID,
      insurer_specific: insurerValue,
      trade: row.trade || null,
      keyword: row.keyword || null,
      item_description: row.item_description || null,
      unit: row.unit || null,
      labour_rate_per_hour: parseCurrency(row.labour_rate_per_hour),
      labour_per_unit: parseCurrency(row.labour_per_unit),
      materials_per_unit: parseCurrency(row.materials_per_unit),
      total_per_unit: parseCurrency(row.total_per_unit),
      estimated_hours: parseCurrency(row.estimated_hours),
      split_type: null,
      pair_id: null,
      updated_at: new Date().toISOString()
    };

    if (dryRun) {
      console.log('Would insert:', JSON.stringify(insertData, null, 2));
      inserted++;
    } else {
      try {
        const { error } = await supabase
          .from('scope_library')
          .insert(insertData);

        if (error) {
          errors.push({ row, error: error.message });
          console.error(`Error inserting row: ${error.message}`);
        } else {
          inserted++;
        }
      } catch (e: any) {
        errors.push({ row, error: e.message });
        console.error(`Exception inserting row: ${e.message}`);
      }
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total rows processed: ${rows.length}`);
  console.log(`Rows skipped (header rows): ${skipped}`);
  console.log(`Rows inserted: ${inserted}`);
  console.log(`Rows with errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\n=== Errors ===');
    errors.forEach(({ row, error }) => {
      console.log(`Row: ${row.trade} - ${row.keyword}`);
      console.log(`Error: ${error}\n`);
    });
  }
}

migrateScopeLibrary().catch(console.error);
