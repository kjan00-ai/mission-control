'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'

type ProposalStatus = 'pending' | 'approved' | 'vetoed'

interface Proposal {
  id: string
  opKey: string
  ruleId: string
  E: string
  enqueuedAt: number
  status: ProposalStatus
  decidedAt: number | null
  decidedBy: string | null
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function DecisionProposalPanel() {
  const t = useTranslations('decisionProposal')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchProposals = useCallback(async () => {
    try {
      const data = await apiFetch<{ proposals?: Proposal[] }>('/api/decision-proposals')
      setProposals(Array.isArray(data.proposals) ? data.proposals : [])
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProposals()
    const interval = setInterval(fetchProposals, 30000)
    return () => clearInterval(interval)
  }, [fetchProposals])

  const decide = async (id: string, action: 'approve' | 'veto') => {
    setBusyId(id)
    setError(null)
    try {
      await apiFetch('/api/decision-proposals', {
        method: 'POST',
        body: JSON.stringify({ id, action }),
      })
      await fetchProposals()
    } catch (err: any) {
      setError(err.message || t('failedAction'))
    } finally {
      setBusyId(null)
    }
  }

  const pendingCount = proposals.filter((p) => p.status === 'pending').length

  return (
    <div className="m-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400 animate-pulse">
              {t('pendingBadge', { count: pendingCount })}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{t('subtitle')}</span>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t('loading')}</div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">{t('noPending')}</div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} busy={busyId === p.id} onDecide={decide} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProposalCard({
  proposal,
  busy,
  onDecide,
}: {
  proposal: Proposal
  busy: boolean
  onDecide: (id: string, action: 'approve' | 'veto') => void
}) {
  const t = useTranslations('decisionProposal')
  const isPending = proposal.status === 'pending'
  const borderColor = isPending ? 'border-l-orange-500' : proposal.status === 'approved' ? 'border-l-green-500' : 'border-l-red-500'

  return (
    <div className={`rounded-lg border border-border bg-card p-4 border-l-4 ${borderColor}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{proposal.ruleId}</span>
          <span className="font-mono text-xs bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">
            {proposal.E}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{proposal.id}</span>
        </div>
        <span className="text-xs text-muted-foreground">{timeAgo(proposal.enqueuedAt)}</span>
      </div>

      {/* opKey (cwd+branch execution context) */}
      <pre className="bg-secondary rounded p-2 text-xs font-mono overflow-auto max-h-20 text-foreground mb-2 border border-border">
        <code>{proposal.opKey}</code>
      </pre>

      {/* Action row */}
      <div className="flex items-center gap-2 mt-3">
        {isPending ? (
          <>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={busy}
              onClick={() => onDecide(proposal.id, 'approve')}
            >
              {t('approve')}
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={busy}
              onClick={() => onDecide(proposal.id, 'veto')}
            >
              {t('veto')}
            </Button>
            {proposal.decidedBy && (
              <span className="text-xs text-muted-foreground">{proposal.decidedBy}</span>
            )}
          </>
        ) : (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              proposal.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}
          >
            {proposal.status === 'approved' ? t('approved') : t('vetoed')}
          </span>
        )}
      </div>
    </div>
  )
}
