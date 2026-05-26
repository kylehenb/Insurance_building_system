import type { IrcCategory } from './types'

export function mapInvoiceTypeToCategory(invoiceType: string): IrcCategory {
  switch (invoiceType) {
    case 'bar_report':
    case 'assessment':
      return 'bar_report'
    case 'roof_report':
      return 'roof_report'
    case 'make_safe':
      return 'make_safe'
    case 'balance':
    case 'repair':
      return 'repair_works'
    case 'excess':
    case 'excess_recovery':
      return 'excess_recovery'
    case 'specialist_report':
      return 'specialist_report'
    case 'leak_detection':
    case 'leak_detection_report':
      return 'leak_detection_report'
    case 'trade_invoice':
      return 'trade_cost'
    default:
      return 'other'
  }
}
