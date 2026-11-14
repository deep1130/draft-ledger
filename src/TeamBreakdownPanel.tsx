import type { ProjectedPick } from './projection'
import './TeamBreakdownPanel.css'

interface TeamBreakdownPanelProps {
  team: ProjectedPick
  lastScoredWeek: number
  regularSeasonEnd: number
}

const formatPts = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function TeamBreakdownPanel({ team, lastScoredWeek, regularSeasonEnd }: TeamBreakdownPanelProps) {
  const firstSimWeek = Math.max(1, lastScoredWeek + 1)
  const seasonWindowLabel = lastScoredWeek > 0 ? `WKS 1–${Math.min(lastScoredWeek, regularSeasonEnd)}` : 'PRE-SEASON'
  const remainingWindowLabel = firstSimWeek <= regularSeasonEnd ? `WKS ${firstSimWeek}–${regularSeasonEnd}` : 'SEASON LOCKED'

  return (
    <div className="team-detail-panel">
      <div className="detail-column">
        <div className="detail-header">
          <div>
            <span className="detail-eyebrow">MOST POINTS CONTRIBUTED THIS SEASON · {seasonWindowLabel}</span>
            <p className="detail-subtitle">Optimal Max PF share credited only for weeks on {team.name}</p>
          </div>
        </div>
        {team.topSeasonContributors.length === 0 ? (
          <p className="detail-empty">No completed weeks scored yet for this franchise.</p>
        ) : (
          <ul className="detail-player-list">
            {team.topSeasonContributors.map((player) => (
              <li key={player.playerId} className="detail-player-row">
                <div className="detail-player-main">
                  <span className={`pos-badge pos-${player.position.toLowerCase()}`}>{player.position}</span>
                  <div className="detail-player-meta">
                    <div className="detail-player-name-row">
                      <span className="detail-player-name">{player.name}</span>
                      {player.nflTeam && <span className="detail-team-abbr">{player.nflTeam}</span>}
                      {!player.onCurrentRoster && (
                        <span className="detail-flag detail-flag-traded" title="Scored for this team earlier, no longer on active roster">
                          TRADED / GONE
                        </span>
                      )}
                    </div>
                    <span className="detail-player-sub">
                      {player.weeksStarted} started ({player.weeksRostered} on roster) · Starter {formatPts(player.starterPoints)}
                    </span>
                  </div>
                </div>
                <div className="detail-player-pts">
                  <strong>{formatPts(player.maxPfPoints)}</strong>
                  <span>MAX PF PTS</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-column">
        <div className="detail-header">
          <div>
            <span className="detail-eyebrow">MOST PROJECTED POINTS REMAINING · {remainingWindowLabel}</span>
            <p className="detail-subtitle">Optimal lineup share on {team.name}, adjusted for trades, byes &amp; injuries</p>
          </div>
        </div>
        {team.topRemainingProjectors.length === 0 ? (
          <p className="detail-empty">
            {firstSimWeek > regularSeasonEnd ? 'Regular season complete — 0 regular-season weeks remaining.' : 'No remaining player projections available.'}
          </p>
        ) : (
          <ul className="detail-player-list">
            {team.topRemainingProjectors.map((player) => (
              <li key={player.playerId} className="detail-player-row">
                <div className="detail-player-main">
                  <span className={`pos-badge pos-${player.position.toLowerCase()}`}>{player.position}</span>
                  <div className="detail-player-meta">
                    <div className="detail-player-name-row">
                      <span className="detail-player-name">{player.name}</span>
                      {player.nflTeam && <span className="detail-team-abbr">{player.nflTeam}</span>}
                      {player.injuryStatus && (
                        <span className="detail-flag detail-flag-inj">{player.injuryStatus.toUpperCase()}</span>
                      )}
                    </div>
                    <span className="detail-player-sub">
                      {player.projectedWeeksStarted} proj start{player.projectedWeeksStarted === 1 ? '' : 's'}
                      {player.projectedTotalPoints > player.projectedStarterPoints + 0.5
                        ? ` · ${formatPts(player.projectedTotalPoints)} total proj`
                        : ''}
                    </span>
                  </div>
                </div>
                <div className="detail-player-pts">
                  <strong>{formatPts(player.projectedStarterPoints)}</strong>
                  <span>PROJ STARTER</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
