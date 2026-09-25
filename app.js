<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Painel de Consultas</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="./styles.css" />
    <script>
      (function () {
        try {
          var saved = localStorage.getItem("theme");
          var theme =
            saved === "dark" || saved === "light"
              ? saved
              : window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
          document.documentElement.setAttribute("data-theme", theme);
        } catch (err) {
          document.documentElement.setAttribute("data-theme", "light");
        }
        try {
          var savedPalette = localStorage.getItem("palette");
          document.documentElement.setAttribute("data-palette", savedPalette === "violeta" ? "violeta" : "rosa");
        } catch (err) {
          document.documentElement.setAttribute("data-palette", "rosa");
        }
      })();
    </script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
    <script defer src="./app.js"></script>
  </head>
  <body>
    <div class="bg-orb orb-1"></div>
    <div class="bg-orb orb-2"></div>

    <!-- ── Tela de login / cadastro ─────────────────────────────────────── -->
    <section id="auth-screen" class="auth-screen">
      <article class="auth-card">
        <p class="eyebrow">Acesso</p>
        <h1>Painel de Consultas</h1>
        <p class="subtitle">Acesso restrito ao grupo. Seus dados ficam salvos na sua conta.</p>

        <div class="auth-grid">
          <form id="login-form" class="auth-form">
            <label>
              E-mail
              <input id="login-email" type="email" required autocomplete="email" />
            </label>
            <label>
              Senha
              <span class="password-field">
                <input id="login-password" type="password" required autocomplete="current-password" />
                <button type="button" class="password-toggle" aria-label="Mostrar senha">👁</button>
              </span>
            </label>
            <button type="submit" class="auth-submit-btn">Entrar</button>
            <p class="auth-switch-row">
              Não tem conta?
              <button id="show-register-btn" class="auth-switch-btn" type="button">Cadastre-se</button>
            </p>
          </form>

          <form id="register-form" class="auth-form hidden">
            <label>
              E-mail
              <input id="register-email" type="email" required autocomplete="email" />
            </label>
            <label>
              Senha <span class="hint-inline">(mínimo 8 caracteres)</span>
              <span class="password-field">
                <input id="register-password" type="password" minlength="8" required autocomplete="new-password" />
                <button type="button" class="password-toggle" aria-label="Mostrar senha">👁</button>
              </span>
            </label>
            <button type="submit" class="auth-submit-btn">Criar conta</button>
            <p class="auth-switch-row">
              Já tem conta?
              <button id="show-login-btn" class="auth-switch-btn" type="button">Entrar</button>
            </p>
          </form>
        </div>
        <p id="auth-message" class="metric-hint"></p>
      </article>
    </section>

    <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false">
      <span id="theme-toggle-icon">🌙</span>
    </button>
    <button id="palette-toggle" class="theme-toggle palette-toggle" type="button" aria-pressed="false" aria-label="Trocar paleta de cores" title="Trocar paleta de cores">
      <span id="palette-toggle-icon">🎨</span>
    </button>

    <!-- ── App ──────────────────────────────────────────────────────────── -->
    <main id="app-shell" class="app-shell hidden">
      <header class="hero">
        <div class="session-bar">
          <p id="session-user-label"></p>
          <p id="sync-status-label" class="sync-status idle">Salvamento: aguardando</p>
          <button id="open-yearly-summary-btn" class="ghost" type="button">Resumo anual</button>
          <button id="change-password-btn" class="ghost" type="button">Trocar senha</button>
          <button id="logout-btn" class="ghost" type="button">Sair</button>
        </div>
        <div>
          <p class="eyebrow">Painel diário</p>
          <h1>Controle de atendimentos e faturamento</h1>
          <p class="subtitle">Registre o atendimento pelo tipo, acompanhe o faturamento do dia e do mês.</p>
        </div>
      </header>

      <section class="actions card">
        <div class="card-head">
          <h2>Registrar atendimento</h2>
          <div class="stopwatch" id="stopwatch">
            <span id="stopwatch-display" class="stopwatch-display">00:00</span>
            <button id="stopwatch-toggle" class="stopwatch-btn" type="button" aria-label="Iniciar cronômetro">▶</button>
            <button id="stopwatch-reset" class="stopwatch-btn" type="button" aria-label="Zerar cronômetro">↺</button>
          </div>
        </div>

        <div class="timeline-box">
          <div class="timeline-head">
            <h3>Linha do tempo dos atendimentos</h3>
            <span id="timeline-empty-label" class="metric-hint"></span>
          </div>
          <div class="timeline-scroll-wrap">
            <button id="timeline-prev" class="ghost timeline-nav" type="button" aria-label="Rolar para trás">‹</button>
            <div class="timeline-viewport">
              <div id="timeline-track" class="timeline-track"></div>
            </div>
            <button id="timeline-next" class="ghost timeline-nav" type="button" aria-label="Rolar para frente">›</button>
          </div>
          <p class="metric-hint">Toque numa bolinha para abrir e editar aquele atendimento.</p>
        </div>

        <label class="quick-name-field">
          Nome do paciente (opcional, para o próximo registro)
          <input id="quick-patient-name" type="text" maxlength="80" placeholder="Digite antes de tocar num botão abaixo" />
        </label>
        <div id="consult-type-grid" class="btn-grid"></div>

        <fieldset id="plantao-shift-override" class="shift-override-box">
          <legend>Plantão ativo no registro</legend>
          <label><input type="checkbox" class="shift-override-check" data-shift="m" /> M</label>
          <label><input type="checkbox" class="shift-override-check" data-shift="t" /> T</label>
          <label><input type="checkbox" class="shift-override-check" data-shift="reforco" /> Reforço</label>
          <label><input type="checkbox" class="shift-override-check" data-shift="noturno" /> Noturno</label>
          <span class="shift-override-hint">Marque M e T juntos para compartilhar o limite de 60 (07:00–19:00)</span>
        </fieldset>

        <div class="action-row">
          <button id="undo-btn" class="ghost" type="button">Desfazer último do dia selecionado</button>
          <button id="apply-shift-override-btn" class="ghost" type="button" title="Marque o turno certo acima e clique aqui para corrigir todos os atendimentos de Plantão já lançados no dia selecionado">Aplicar turno aos atendimentos já registrados</button>
        </div>
        <details class="price-settings-box">
          <summary>Ajustar valores (Adulto, Pediatria, One)</summary>
          <form id="type-prices-form" class="type-prices-form">
            <label>
              Adulto (R$)
              <input id="price-adulto" type="number" min="0" step="0.5" />
            </label>
            <label>
              Pediatria (R$)
              <input id="price-pediatria" type="number" min="0" step="0.5" />
            </label>
            <label>
              One (R$)
              <input id="price-one" type="number" min="0" step="0.5" />
            </label>
          </form>
          <p class="metric-hint">
            O Plantão é calculado automaticamente pelo horário do registro — veja as faixas abaixo.
          </p>
        </details>
        <details class="price-settings-box">
          <summary>Ver faixas de preço do Plantão</summary>
          <div class="plantao-help">
            <p><strong>M</strong> (07:00–13:00): se estiver sozinho, 30 primeiros por R$ 20, depois R$ 15.</p>
            <p><strong>T</strong> (13:00–19:00): se estiver sozinho, 30 primeiros por R$ 20, depois R$ 15.</p>
            <p><strong>M + T</strong>: se os dois estiverem marcados juntos, compartilham 60 atendimentos por R$ 20 entre 07:00 e 19:00; depois R$ 15.</p>
            <p><strong>Reforço</strong> (19:00–00:00): 25 primeiros por R$ 20, depois R$ 15.</p>
            <p><strong>Noturno</strong> (00:00–07:00), com o turno marcado: 25 primeiros por R$ 28, depois R$ 15.</p>
            <p><strong>Madrugada sem marcar Noturno</strong>: fica em R$ 20 fixo (a diária de R$ 28 exige o turno Noturno marcado).</p>
            <p class="metric-hint">A contagem de cada faixa reinicia todo dia. Marque o turno errado por engano e já registrou atendimentos? Marque o turno certo e use "Aplicar turno aos atendimentos já registrados" para corrigir o dia inteiro de uma vez.</p>
          </div>
        </details>
        <details class="price-settings-box">
          <summary>Adicionar atendimento manual (outra data/hora)</summary>
          <form id="manual-form" class="manual-form">
            <label>
              Nome do paciente
              <input id="manual-name" type="text" maxlength="80" placeholder="Opcional" />
            </label>
            <label>
              Data
              <input id="manual-date" type="date" required />
            </label>
            <label>
              Hora
              <input id="manual-time" type="time" required />
            </label>
            <label>
              Tipo
              <select id="manual-type" required>
                <option value="adulto">Adulto</option>
                <option value="pediatria">Pediatria</option>
                <option value="one">One</option>
                <option value="plantao">Plantão</option>
              </select>
            </label>
            <label class="manual-check">
              <input id="manual-atestado" type="checkbox" />
              Com atestado
            </label>
            <button type="submit" class="ghost">Salvar manual</button>
          </form>
        </details>
      </section>

      <section id="metrics-grid" class="metrics-grid">
        <article class="metric card">
          <p class="metric-label">Data selecionada</p>
          <p id="selected-date-label" class="metric-value"></p>
        </article>
        <article class="metric card">
          <p class="metric-label">Total de atendimentos</p>
          <p id="total-count" class="metric-value"></p>
        </article>
        <article class="metric card">
          <p class="metric-label">Faturamento do dia</p>
          <p id="total-revenue" class="metric-value"></p>
        </article>
        <article class="metric card">
          <p class="metric-label">R$/hora (bruta)</p>
          <p id="gross-revenue-per-hour" class="metric-value"></p>
          <p class="metric-hint">Faturamento dividido pelo tempo entre o 1º e o último atendimento.</p>
        </article>
        <article class="metric card">
          <p class="metric-label">Ticket médio</p>
          <p id="avg-ticket" class="metric-value"></p>
          <p class="metric-hint">Faturamento do dia dividido pelo total de atendimentos.</p>
        </article>
        <article class="metric card">
          <p class="metric-label">% com atestado</p>
          <p id="atestado-rate" class="metric-value"></p>
        </article>
      </section>

      <section class="split-layout">
        <article class="card">
          <div class="card-head">
            <h2>Detalhe do dia</h2>
            <p id="type-breakdown"></p>
          </div>
          <canvas id="day-chart" height="180"></canvas>
          <button id="day-list-toggle" class="day-list-head" type="button" aria-expanded="false" aria-controls="day-list">
            <h3>Registros do dia</h3>
            <span class="day-list-head-right">
              <span id="day-list-count" class="metric-hint"></span>
              <span class="day-list-arrow" aria-hidden="true">▾</span>
            </span>
          </button>
          <ul id="day-list" class="day-list is-collapsed"></ul>
        </article>

        <article class="card">
          <div class="calendar-head">
            <button id="prev-month" class="ghost" type="button">◀</button>
            <h2 id="calendar-title"></h2>
            <button id="next-month" class="ghost" type="button">▶</button>
          </div>
          <div class="weekdays">
            <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span
            ><span>Dom</span>
          </div>
          <div id="calendar-grid" class="calendar-grid"></div>
          <section class="month-goal-panel">
            <h3 id="month-goal-title">Meta do mês</h3>
            <label class="target-hours month-goal-input-wrap">
              <span>Meta do mês (R$)</span>
              <input id="monthly-target" type="number" min="0" step="50" />
            </label>
            <div class="month-goal-grid">
              <article class="month-goal-card">
                <p class="metric-label">Meta do mês</p>
                <p id="month-goal-value" class="metric-value"></p>
                <p id="month-goal-achieved" class="metric-hint"></p>
              </article>
              <article class="month-goal-card">
                <p class="metric-label">Falta para meta</p>
                <p id="month-goal-remaining" class="metric-value"></p>
                <p id="month-goal-progress" class="metric-hint"></p>
              </article>
              <article class="month-goal-card">
                <p class="metric-label">Atendimentos no mês</p>
                <p id="month-total-consults" class="metric-value"></p>
                <p id="month-total-breakdown" class="metric-hint"></p>
              </article>
            </div>
          </section>
        </article>
      </section>

      <section class="card schedule-card">
        <div class="card-head">
          <h2>Escala de plantões</h2>
          <div class="schedule-view-toggle">
            <button id="schedule-view-week" class="ghost schedule-view-btn" type="button">Semana</button>
            <button id="schedule-view-month" class="ghost schedule-view-btn active" type="button">Mês</button>
          </div>
        </div>
        <p class="metric-hint">Visualize a escala por semana ou mês e clique em um dia para ver os turnos de Plantão.</p>
        <p class="metric-hint schedule-legend">Turno com fundo colorido = já atendido. Turno tracejado = planejado (ainda não atendido).</p>
        <div class="schedule-nav">
          <button id="schedule-prev" class="ghost" type="button">◀</button>
          <h3 id="schedule-title"></h3>
          <button id="schedule-next" class="ghost" type="button">▶</button>
        </div>
        <div class="weekdays">
          <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span
          ><span>Dom</span>
        </div>
        <div id="schedule-grid" class="schedule-grid"></div>
        <div id="schedule-detail" class="schedule-detail"></div>
      </section>

      <section class="card atestado-summary-card">
        <h2>Atendimentos com e sem atestado no mês</h2>
        <div class="atestado-total-grid">
          <article class="atestado-total-card">
            <p class="metric-label">Total com atestado</p>
            <p id="atestado-total-com" class="metric-value"></p>
            <p id="atestado-total-com-hint" class="metric-hint"></p>
          </article>
          <article class="atestado-total-card">
            <p class="metric-label">Total sem atestado</p>
            <p id="atestado-total-sem" class="metric-value"></p>
            <p id="atestado-total-sem-hint" class="metric-hint"></p>
          </article>
        </div>
        <p class="metric-hint atestado-summary-note">Totais de todos os tipos de atendimento no mês, incluindo plantões.</p>
        <div id="atestado-type-grid" class="atestado-type-grid"></div>
      </section>

      <section class="card job2-card">
        <div class="card-head">
          <h2>Emprego 2 (plantões por hora)</h2>
        </div>
        <p class="metric-hint">Registre os plantões do seu outro trabalho, pagos por hora, para acompanhar o faturamento dele separado dos atendimentos acima.</p>

        <form id="job2-form" class="job2-form">
          <div class="job2-calendar-box">
            <div class="job2-calendar-head">
              <button id="job2-cal-prev" class="ghost" type="button">◀</button>
              <h3 id="job2-cal-title"></h3>
              <button id="job2-cal-next" class="ghost" type="button">▶</button>
            </div>
            <div class="weekdays">
              <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span
              ><span>Dom</span>
            </div>
            <div id="job2-calendar-grid" class="calendar-grid job2-calendar-grid"></div>
            <input id="job2-date" type="hidden" />
          </div>

          <fieldset class="job2-shift-box">
            <legend>Turno do plantão</legend>
            <label><input type="radio" name="job2-shift" class="job2-shift-radio" value="mt" checked /> M+T (07h–19h)</label>
            <label><input type="radio" name="job2-shift" class="job2-shift-radio" value="m" /> M (07h–13h)</label>
            <label><input type="radio" name="job2-shift" class="job2-shift-radio" value="t" /> T (13h–19h)</label>
            <label><input type="radio" name="job2-shift" class="job2-shift-radio" value="reforco" /> 17h–23h</label>
          </fieldset>

          <fieldset class="job2-category-box">
            <legend>Função</legend>
            <label><input type="radio" name="job2-category" class="job2-category-radio" value="generalista" checked /> Generalista</label>
            <label><input type="radio" name="job2-category" class="job2-category-radio" value="prep" /> Prep</label>
          </fieldset>

          <label class="job2-rate-field">
            Valor/hora (R$)
            <input id="job2-rate" type="number" min="0" step="0.5" required />
          </label>
          <button type="submit" class="ghost">Registrar plantão</button>
        </form>

        <h3 id="job2-month-label" class="job2-list-title">Resumo do mês</h3>
        <div class="job2-summary-grid">
          <article class="metric card job2-metric">
            <p class="metric-label">Horas no mês</p>
            <p id="job2-month-hours" class="metric-value"></p>
          </article>
          <article class="metric card job2-metric">
            <p class="metric-label">Bruto no mês</p>
            <p id="job2-month-gross" class="metric-value"></p>
          </article>
          <article class="metric card job2-metric">
            <p class="metric-label">Líquido estimado</p>
            <p id="job2-month-net" class="metric-value"></p>
          </article>
        </div>

        <details class="price-settings-box">
          <summary>Ajustar percentual de desconto estimado</summary>
          <form id="job2-discount-form" class="type-prices-form">
            <label>
              INSS (%)
              <input id="job2-inss-percent" type="number" min="0" max="100" step="0.1" />
            </label>
            <label>
              IRRF efetivo (%)
              <input id="job2-irrf-percent" type="number" min="0" max="100" step="0.1" />
            </label>
          </form>
          <p id="job2-net-factor-hint" class="metric-hint"></p>
          <p class="metric-hint">Estimativa a partir dos extratos de repasse enviados. A alíquota de IRRF é progressiva e pode mudar conforme sua renda no mês — ajuste aqui se o extrato real mostrar outro valor.</p>
        </details>

        <h3 class="job2-list-title">Plantões do mês exibido acima</h3>
        <ul id="job2-list" class="day-list"></ul>
      </section>

      <section class="charts-row">
        <article class="card">
          <h2>Semana (atendimentos e faturamento)</h2>
          <canvas id="week-chart" height="140"></canvas>
        </article>
        <article class="card">
          <h2>Mês (atendimentos e faturamento)</h2>
          <canvas id="month-chart" height="140"></canvas>
        </article>
      </section>
    </main>

    <!-- ── Modal: editar atendimento ────────────────────────────────────── -->
    <div id="edit-record-modal" class="modal-overlay hidden" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-record-title">
        <div class="modal-head">
          <h2 id="edit-record-title">Editar atendimento</h2>
          <button id="close-edit-record-modal" class="ghost" type="button">Fechar</button>
        </div>
        <form id="edit-record-form" class="manual-form">
          <label>
            Nome do paciente
            <input id="edit-record-name" type="text" maxlength="80" placeholder="Opcional" />
          </label>
          <label>
            Data
            <input id="edit-record-date" type="date" required />
          </label>
          <label>
            Hora
            <input id="edit-record-time" type="time" required />
          </label>
          <label>
            Tipo
            <select id="edit-record-type" required>
              <option value="adulto">Adulto</option>
              <option value="pediatria">Pediatria</option>
              <option value="one">One</option>
              <option value="plantao">Plantão</option>
            </select>
          </label>
          <label class="manual-check">
            <input id="edit-record-atestado" type="checkbox" />
            Com atestado
          </label>
          <label>
            Valor (R$)
            <input id="edit-record-price" type="number" min="0" step="0.5" required />
          </label>
          <div class="modal-actions">
            <button type="submit" class="ghost">Salvar edição</button>
            <button id="delete-record-btn" type="button" class="ghost">Excluir atendimento</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ── Modal: resumo anual + exportação ─────────────────────────────── -->
    <div id="yearly-summary-modal" class="modal-overlay hidden" aria-hidden="true">
      <div class="modal-card modal-card-lg" role="dialog" aria-modal="true" aria-labelledby="yearly-summary-title">
        <div class="modal-head">
          <h2 id="yearly-summary-title">Resumo anual</h2>
          <button id="close-yearly-summary-modal" class="ghost" type="button">Fechar</button>
        </div>

        <div class="yearly-nav">
          <button id="yearly-summary-prev" class="ghost" type="button" aria-label="Ano anterior">‹</button>
          <span id="yearly-summary-year-label" class="yearly-year-label"></span>
          <button id="yearly-summary-next" class="ghost" type="button" aria-label="Próximo ano">›</button>
        </div>

        <table class="yearly-table">
          <thead>
            <tr>
              <th>Mês</th>
              <th>Atendimentos</th>
              <th>Faturamento</th>
            </tr>
          </thead>
          <tbody id="yearly-summary-body"></tbody>
          <tfoot>
            <tr>
              <th>Total do ano</th>
              <th id="yearly-summary-total-count"></th>
              <th id="yearly-summary-total-revenue"></th>
            </tr>
          </tfoot>
        </table>

        <div class="yearly-export-box">
          <h3>Baixar atendimentos de um mês</h3>
          <p class="metric-hint">Baixa todos os atendimentos do mês escolhido, um por linha, com nome, data, hora, tipo e valor.</p>
          <div class="yearly-export-row">
            <label>
              Mês
              <select id="export-month-select"></select>
            </label>
            <button id="export-month-csv" class="ghost" type="button">Baixar planilha (CSV)</button>
            <button id="export-month-pdf" class="ghost" type="button">Baixar PDF</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Modal: trocar senha ──────────────────────────────────────────── -->
    <div id="password-modal" class="modal-overlay hidden" aria-hidden="true">
      <div class="modal-card modal-card-sm" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
        <div class="modal-head">
          <h2 id="password-modal-title">Trocar senha</h2>
          <button id="close-password-modal" class="ghost" type="button">Fechar</button>
        </div>
        <form id="password-form" class="auth-form">
          <label>
            Senha atual
            <input id="current-password" type="password" required autocomplete="current-password" />
          </label>
          <label>
            Nova senha <span class="hint-inline">(mínimo 8 caracteres)</span>
            <input id="new-password" type="password" minlength="8" required autocomplete="new-password" />
          </label>
          <button type="submit" class="auth-submit-btn">Salvar nova senha</button>
        </form>
        <p id="password-message" class="metric-hint"></p>
      </div>
    </div>
  </body>
</html>
