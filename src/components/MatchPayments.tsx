import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { dataService } from '../services/apiService'
import type { CollectionEntry } from '../types'
import { formatCurrency, formatDate } from '../utils/helpers'
import { Button } from './ui'

export function MatchPayments({ rows, review, reload }: {
  rows: CollectionEntry[]
  review: (row: CollectionEntry) => void
  reload: () => Promise<void>
}) {
  const { donations, accounts } = useApp()
  const [tab, setTab] = useState('Ready to approve')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const bank = accounts.find(a => a.type === 'bank' && a.accountName === 'ICICI') ||
    accounts.find(a => a.type === 'bank' && a.accountName === 'Main Bank Account')
  const credits = donations.filter(d => bank && d.accountID === bank.accountID && d.bankImportKey && !d.deleted && !d.collectionID)
  const claimed = new Map<string, number>()
  const reports = rows.filter(r => r.status === 'Pending review' && r.details.kind !== 'materials' && r.details.method !== 'Cash').map(row => {
    const data = row.details
    const ref = String(data.reference || '').trim().toLowerCase()
    const possible = credits.filter(d => d.amount === Number(data.amount) && (!d.donorID || d.donorID === data.donorID) &&
      (!d.installmentPlanID || d.installmentPlanID === data.planID))
    const exact = possible.filter(d => ref && [d.transactionReference, /^Bank payment reference: (.+)$/m.exec(d.notes || '')?.[1]]
      .some(value => value?.trim().toLowerCase() === ref))
    for (const d of exact) claimed.set(d.donationID, (claimed.get(d.donationID) || 0) + 1)
    return { row, exact, possible }
  })
  const groups = reports.map(r => {
    const d = r.exact[0]
    const ready = r.exact.length === 1 && d.donorID && d.donorID === r.row.details.donorID && claimed.get(d.donationID) === 1
    return { ...r, tab: ready ? 'Ready to approve' : r.possible.length ? 'Needs review' : 'Waiting for a match' }
  })
  const suggested = new Set(reports.flatMap(r => r.possible.map(d => d.donationID)))
  const unmatched = credits.filter(d => !suggested.has(d.donationID) && !d.installmentPlanID)
  const visible = groups.filter(r => r.tab === tab)
  return <details className="rounded-lg border p-4">
    <summary className="cursor-pointer font-semibold">Match payments</summary>
    <div className="my-3 flex flex-wrap gap-2">{['Ready to approve', 'Needs review', 'Waiting for a match'].map(t =>
      <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>{t} ({groups.filter(r => r.tab === t).length + (t === 'Waiting for a match' ? unmatched.length : 0)})</Button>)}</div>
    {message && <p role="status">{message}</p>}
    {visible.map(({ row, exact, possible }) => <div className="grid gap-2 border-t py-3 md:grid-cols-3" key={row.id}>
      <div><strong>{row.details.name}</strong><p>{row.collector} · {formatCurrency(Number(row.details.amount))}</p><p>{formatDate(row.details.date)} · {row.details.reference}</p></div>
      <div>{tab === 'Ready to approve' ? <><strong>ICICI credit · {formatCurrency(exact[0].amount)}</strong><p>{exact[0].donorName} · {formatDate(exact[0].date)}</p>{exact[0].transactionReference}</> : possible.length ? possible.length + ' possible bank receipts' : 'Waiting for an eligible ICICI credit'}</div>
      <div>{tab === 'Ready to approve' ? <Button disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          await dataService.reviewCollection(row.id, 'Approved', '', bank!.accountID, true, exact[0].donationID)
          await reload()
          setMessage('Payment matched and approved.')
        } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not approve this match.') }
        finally { setBusy(false) }
      }}>Approve match</Button> : <Button variant="secondary" onClick={() => review(row)}>Review payment</Button>}</div>
    </div>)}
    {tab === 'Waiting for a match' && unmatched.map(d => <p className="border-t py-2" key={d.donationID}>Bank credit · {d.donorName} · {formatCurrency(d.amount)} · {formatDate(d.date)} · {d.transactionReference || d.receiptNumber} · No matching collector report</p>)}
    {!visible.length && !(tab === 'Waiting for a match' && unmatched.length) && <p>No payments in this list.</p>}
  </details>
}
