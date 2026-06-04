// Insurer + adjuster template registry.
// Returns a key used by both the editor (client) and the print page (server)
// to select the correct form and PDF template.
//
// To add a new insurer/adjuster workflow:
// 1. Add a new key to InsurerTemplateKey
// 2. Add a new match condition in getInsurerTemplateKey
// 3. Create the corresponding form in components/reports/insurer-forms/
// 4. Create the corresponding PDF template in app/print/reports/[reportId]/templates/

export type InsurerTemplateKey = 'default' | 'allianz-sedgwick'

export function getInsurerTemplateKey(
  insurer: string | null | undefined,
  adjuster: string | null | undefined
): InsurerTemplateKey {
  const i = (insurer ?? '').toLowerCase()
  const a = (adjuster ?? '').toLowerCase()

  if (i.includes('allianz') && a.includes('sedgwick')) return 'allianz-sedgwick'

  return 'default'
}
