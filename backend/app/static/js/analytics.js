const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));

export const renderAnalytics = (container, analytics) => {
  const rows = (analytics.leaderboard || []).map((entry) => `
    <tr>
      <td>${esc(entry.name) || '<span class="muted">Anonymous</span>'}</td>
      <td class="muted">${esc(entry.email)}</td>
      <td class="score">${entry.score}/${entry.total}</td>
      <td>${entry.percentage}%</td>
    </tr>`).join("");
  const table = (analytics.leaderboard || []).length
    ? `<div class="table-scroll"><table class="leaderboard"><thead><tr><th>Name</th><th>Email</th><th>Score</th><th>%</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty-state"><div class="empty-icon">📊</div><h4>No responses yet</h4><p>Share the public quiz link to collect submissions.</p></div>';
  container.innerHTML = `<h3>Participant scores</h3>${table}`;
};