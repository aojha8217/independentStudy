(() => {
  'use strict';

  const app = document.querySelector('#app');
  const toastEl = document.querySelector('#toast');
  let stream = null;
  const params = new URLSearchParams(window.location.search);
  const linkedCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const prompts = [
    'What is your most irrational fear?',
    'What is a hill you would die on?',
    'What is your most embarrassing celebrity crush?',
    'What is something you pretend to like?',
    'What is the worst first-date idea?',
    'What is your most controversial food opinion?',
    'Which fictional character is your alter ego?',
    'What is the weirdest thing in your search history?',
    'What is your secret useless talent?',
    'What is the worst excuse you have ever used?',
    'What is a ridiculous thing you believed as a kid?',
    'What is one thing you would never admit on a first date?',
    'What would your warning label say?',
    'If you were arrested, what would your friends assume you did?',
    'What is something you would be strangely good at competing in?'
  ];

  let game = null;
  let sessionCode = linkedCode || null;
  let answerDraft = null;
  let questionDraft = null;
  let nextDraft = null;
  let joinNameDraft = localStorage.getItem('empire-last-name') || '';
  let createNameDraft = localStorage.getItem('empire-last-name') || '';
  let createQuestionDraft = prompts[0];
  let joinCodeDraft = linkedCode;
  let toastTimer;

  function h(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function safeStorageGet(code) {
    try { return JSON.parse(localStorage.getItem(`empire-session-${code}`) || 'null'); } catch { return null; }
  }
  function saveSession(code, playerToken, hostKey) {
    localStorage.setItem(`empire-session-${code}`, JSON.stringify({ code, playerToken, hostKey: hostKey || null }));
  }
  function saveName(name) { localStorage.setItem('empire-last-name', name); }
  function showToast(message, error = false) {
    toastEl.textContent = message;
    toastEl.className = `${error ? 'error ' : ''}show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, 3200);
  }
  async function request(name, payload = {}) {
    const action = name.replace(/^room:/, '');
    const stored = sessionCode ? safeStorageGet(sessionCode) : null;
    const body = ['create', 'join'].includes(action) ? payload : {
      code: sessionCode, playerToken: stored?.playerToken, hostKey: stored?.hostKey, ...payload
    };
    let response;
    try {
      response = await fetch(`/api/${action}`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      });
    } catch { throw new Error('Connection unavailable. Check your internet and try again.'); }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }
  function connectStream(code) {
    if (stream) stream.close();
    const saved = safeStorageGet(code);
    if (!saved) return;
    const query = new URLSearchParams({code, playerToken:saved.playerToken});
    if (saved.hostKey) query.set('hostKey', saved.hostKey);
    stream = new EventSource(`/api/events?${query}`);
    stream.onmessage = event => {
      const incoming = JSON.parse(event.data);
      syncDrafts(incoming);
      const previous = game;
      game = incoming;
      renderGame(previous);
    };
    stream.addEventListener('removed', () => {
      stream.close();
      localStorage.removeItem(`empire-session-${code}`);
      game = null;
      sessionCode = null;
      history.replaceState({}, '', '/');
      renderHome();
      showToast('The host removed you from the room.', true);
    });
    stream.onerror = () => {if (game) showToast('Reconnecting…', true);};
  }
  async function run(event, data, after) {
    try { const result = await request(event, data); if (after) after(result); }
    catch (error) { showToast(error.message, true); }
  }
  function route(code) {
    sessionCode = code;
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    history.replaceState({}, '', url);
  }
  function renderHome() {
    game = null;
    app.innerHTML = `
      <section class="hero"><div class="eyebrow">THE PARTY STARTS HERE</div>
        <h1>Who said <span class="accent">that?</span></h1>
        <p class="subhead">Everyone answers the same question. Answers get shuffled. Now guess which of your friends said what.</p>
      </section>
      <div class="entry-grid">
        <section class="panel"><h2>Start a game <span style="color:var(--lime)">✳</span></h2>
          <p class="panel-description">Be the host. Choose the question, share a link, and reveal the answers.</p>
          <form id="create-form"><div class="field"><label for="create-name">YOUR NAME</label><input id="create-name" name="name" autocomplete="nickname" maxlength="30" placeholder="e.g. Alex" required value="${h(createNameDraft)}"></div>
          <div class="field"><label for="create-question">FIRST QUESTION</label><textarea id="create-question" name="question" maxlength="200" required>${h(createQuestionDraft)}</textarea></div>
          <button class="btn btn-primary btn-wide" type="submit">Create a room <span>↗</span></button></form>
        </section>
        <section class="panel"><h2>Join a game</h2>
          <p class="panel-description">Got a link or a room code? Jump right in. No account needed.</p>
          <form id="join-form"><div class="field"><label for="join-name">YOUR NAME</label><input id="join-name" name="name" autocomplete="nickname" maxlength="30" placeholder="e.g. Sam" required value="${h(joinNameDraft)}"></div>
          <div class="field"><label for="join-code">ROOM CODE</label><input id="join-code" name="code" autocapitalize="characters" maxlength="6" placeholder="ABC123" required value="${h(joinCodeDraft)}" style="text-transform:uppercase;letter-spacing:.13em;"></div>
          <button class="btn btn-secondary btn-wide" type="submit">Join room →</button></form>
        </section>
      </div>
      <div class="how"><span><b>01</b> Share the link</span><span><b>02</b> Answer secretly</span><span><b>03</b> Guess who said it</span></div>`;
  }
  function playersList() {
    return game.players.map(p => `
      <div class="player-row ${p.online ? '' : 'offline'}">
        <div class="player-id"><div class="avatar">${h(p.name.slice(0,1).toUpperCase())}</div>
          <span class="player-name">${h(p.name)}${p.id === game.me.id ? ' <span style="color:var(--muted);font-weight:400">(you)</span>' : ''}</span></div>
        <span class="player-tag ${p.submitted ? 'done' : ''}">${p.submitted ? '✓ Ready' : p.online ? 'Thinking…' : 'Offline'}</span>
        ${game.isHost && p.id !== game.me.id && game.phase === 'collect' ? `<button class="tiny-x" aria-label="Remove ${h(p.name)}" title="Remove player" data-action="kick" data-id="${h(p.id)}">×</button>` : ''}
      </div>`).join('');
  }
  function renderLobby() {
    const allAnswered = game.submittedCount === game.players.length;
    const link = new URL('/', window.location.origin); link.searchParams.set('room', game.roomCode);
    app.innerHTML = `
      <div class="room-top"><div><span class="room-label">YOUR ROOM · <span class="connected">LIVE</span></span><h1>Let the chaos begin<span class="accent">.</span></h1></div><span class="round-pill">✳ ROUND ${game.round}</span></div>
      <div class="share-bar"><div class="share-left"><span class="mini-label">ROOM CODE · INVITE YOUR FRIENDS</span><div class="share-code">${h(game.roomCode)}</div></div>
        <div class="share-actions"><button class="btn btn-secondary btn-small" data-action="copy">↗ Copy link</button><button class="btn btn-primary btn-small" data-action="share">Share <span>↗</span></button></div></div>
      <div class="content-grid"><div class="stack">
        <section class="panel"><div class="question-top">✦ THE QUESTION</div>
          ${game.isHost ? `<form id="question-form"><div class="field"><label for="question">EVERYONE ANSWERS THIS</label>
            <textarea id="question" name="question" maxlength="200" required>${h(questionDraft)}</textarea></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px"><button type="submit" class="btn btn-secondary">Update question</button><button type="button" class="btn btn-outline" data-action="random-question">✳ Surprise me</button></div>
            ${game.submittedCount ? '<p class="note note-warning">Changing the question clears all submitted answers.</p>' : ''}</form>` : `<h2 class="question-display">${h(game.question)}</h2><span class="status"><span class="status-dot"></span> Answers are anonymous</span>`}
        </section>
        <section class="panel"><h2 class="section-heading">Your secret answer</h2><p class="section-description">Only the host can see answers after they’re shuffled. Nobody sees who wrote what until the reveal.</p>
          <form id="answer-form"><div class="field"><label for="answer">${game.myAnswer ? 'YOUR ANSWER · SAVED' : 'TYPE SOMETHING GOOD'}</label>
            <textarea id="answer" maxlength="220" name="answer" required placeholder="Don't overthink it…">${h(answerDraft)}</textarea></div>
            <button type="submit" class="btn btn-primary btn-wide">${game.myAnswer ? 'Update my answer ✓' : 'Submit answer anonymously →'}</button></form>
          ${game.myAnswer ? '<p class="note"><span style="color:var(--lime)">●</span> You’re in! You can still edit until the host shuffles.</p>' : '<p class="note">Your answer stays hidden during collection.</p>'}
        </section>
      </div><aside class="stack">
        <section class="panel"><div class="progress-head"><h2 class="section-heading">The players</h2><span class="count">${game.submittedCount}/${game.players.length}</span></div>
          <div class="track"><div class="fill" style="width:${game.players.length ? game.submittedCount / game.players.length * 100 : 0}%"></div></div>
          <div class="players">${playersList()}</div>
          <p class="note">${allAnswered ? 'Everyone is ready!' : 'Waiting for more secret answers…'}</p>
        </section>
        ${game.isHost ? `<section class="panel"><h2 class="section-heading">Host controls</h2><p class="section-description">Once you're ready, shuffle the answers. You will get a secret answer board to read aloud.</p>
          <button class="btn btn-primary btn-wide" data-action="reveal" ${game.submittedCount === 0 ? 'disabled' : ''}>Shuffle & reveal ${game.submittedCount} answer${game.submittedCount === 1 ? '' : 's'} ↗</button>
          ${!allAnswered && game.submittedCount > 0 ? '<p class="note">You can start even if some people haven’t answered.</p>' : ''}</section>` : `<section class="panel"><h2 class="section-heading">What happens next?</h2><p class="section-description">Your host will shuffle all answers and read them out. Guess who said each one!</p>
          <span class="status"><span class="status-dot"></span> ${game.myAnswer ? 'Ready to play' : 'Waiting for your answer'}</span></section>`}
      </aside></div>`;
  }
  function renderReveal() {
    if (!game.isHost) {
      app.innerHTML = `<div class="room-top"><div><span class="room-label">ROOM ${h(game.roomCode)}</span><h1>Round ${game.round}<span class="accent">.</span></h1></div><span class="round-pill">✳ GUESSING TIME</span></div>
        <section class="panel waiting"><div class="waiting-graphic">✳</div><div class="eyebrow">ANSWERS ARE IN</div>
          <h1>Who said <span class="accent">that?</span></h1><p>Your host has the shuffled answers. Listen up, guess who wrote each one, and defend your ridiculous choices.</p><p class="note">${game.revealedCount} of ${game.submittedCount} identities revealed</p></section>`;
      return;
    }
    app.innerHTML = `<div class="reveal-hero"><div class="eyebrow">ROUND ${game.round} · THE BIG REVEAL</div><h1>Time to <span class="accent">expose them.</span></h1>
      <p>${h(game.question)}</p><div class="round-pill" style="display:inline-flex">${game.revealedCount} / ${game.answerBoard.length} identities revealed</div></div>
      <div class="board">${game.answerBoard.map((item, i) => `
        <article class="answer-card ${item.revealedName ? 'revealed' : ''}"><div class="answer-num">ANSWER ${String(i+1).padStart(2,'0')}</div>
          <div class="answer-text">“${h(item.text)}”</div>
          <div class="reveal-bottom">${item.revealedName ? `<div class="identity"><span class="arrow">↳</span> ${h(item.revealedName)}</div>` : `<button class="btn btn-reveal btn-small" data-action="reveal-one" data-id="${h(item.id)}">Who said it? 👀</button>`}</div></article>`).join('')}</div>
      <section class="panel" style="max-width:580px;margin:18px auto 0"><h2 class="section-heading">Keep the game going ✳</h2><p class="section-description">Everyone stays in the room. Pick a new question and collect fresh answers.</p>
        <form id="next-form"><div class="field"><label for="next-question">NEXT QUESTION</label><textarea id="next-question" maxlength="200" required placeholder="Something spicy, funny, or absurd…">${h(nextDraft)}</textarea></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-outline" type="button" data-action="random-next">✳ Pick for me</button><button class="btn btn-primary" type="submit" style="flex:1">Start round ${game.round + 1} ↗</button></div></form></section>`;
  }
  function renderGame(previous) {
    if (!game) return renderHome();
    // Avoid interrupting someone typing when other players send their answers.
    const activeId = document.activeElement?.id;
    if (previous && previous.phase === 'collect' && game.phase === 'collect' &&
        previous.roomCode === game.roomCode && previous.round === game.round &&
        previous.question === game.question && ['answer', 'question'].includes(activeId)) {
      const count = document.querySelector('.count');
      if (count) count.textContent = `${game.submittedCount}/${game.players.length}`;
      const fill = document.querySelector('.fill');
      if (fill) fill.style.width = `${game.players.length ? game.submittedCount / game.players.length * 100 : 0}%`;
      const players = document.querySelector('.players');
      if (players) players.innerHTML = playersList();
      const reveal = document.querySelector('[data-action="reveal"]');
      if (reveal) {
        reveal.disabled = game.submittedCount === 0;
        reveal.textContent = `Shuffle & reveal ${game.submittedCount} answer${game.submittedCount === 1 ? '' : 's'} ↗`;
      }
      return;
    }
    game.phase === 'collect' ? renderLobby() : renderReveal();
  }
  function randomQuestion() {
    let choices = prompts.filter(p => p !== game?.question);
    if (!choices.length) choices = prompts;
    return choices[Math.floor(Math.random() * choices.length)];
  }
  async function copyLink() {
    const url = `${location.origin}/?room=${encodeURIComponent(game.roomCode)}`;
    try { await navigator.clipboard.writeText(url); showToast('Invite link copied!'); }
    catch { window.prompt('Copy this link:', url); }
  }
  async function shareLink() {
    const url = `${location.origin}/?room=${encodeURIComponent(game.roomCode)}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my Empire game', text: `Join my Empire game! Room code: ${game.roomCode}`, url }); }
      catch (error) { if (error.name !== 'AbortError') copyLink(); }
    } else copyLink();
  }
  function syncDrafts(incoming) {
    if (!game || incoming.roomCode !== game.roomCode || incoming.round !== game.round || incoming.phase !== game.phase) {
      answerDraft = incoming.myAnswer || '';
      questionDraft = incoming.question;
      nextDraft = randomQuestion();
    } else if (incoming.question !== game.question) {
      answerDraft = incoming.myAnswer || '';
      questionDraft = incoming.question;
    }
  }
  async function rejoinSaved(code) {
    const saved = safeStorageGet(code);
    if (!saved?.playerToken && !saved?.hostKey) return false;
    app.innerHTML = '<div class="loading"><span class="spinner"></span> Rejoining your room…</div>';
    try {
      const result = await request('room:join', {code, playerToken:saved.playerToken, hostKey:saved.hostKey});
      saveSession(code, result.playerToken, result.hostKey);
      connectStream(code);
      return true;
    } catch (error) {
      localStorage.removeItem(`empire-session-${code}`);
      game = null;
      renderHome();
      showToast(error.message, true);
      return false;
    }
  }

  document.addEventListener('input', event => {
    const id = event.target?.id;
    if (id === 'answer') answerDraft = event.target.value;
    if (id === 'question') questionDraft = event.target.value;
    if (id === 'next-question') nextDraft = event.target.value;
    if (id === 'create-name') createNameDraft = event.target.value;
    if (id === 'create-question') createQuestionDraft = event.target.value;
    if (id === 'join-name') joinNameDraft = event.target.value;
    if (id === 'join-code') joinCodeDraft = event.target.value.toUpperCase();
  });

  document.addEventListener('submit', async event => {
    const id = event.target.id;
    if (!['create-form','join-form','answer-form','question-form','next-form'].includes(id)) return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      if (id === 'create-form') {
        const name = form.elements.name.value.trim();
        const question = form.elements.question.value.trim();
        const result = await request('room:create', { name, question });
        saveName(name);
        saveSession(result.code, result.playerToken, result.hostKey);
        route(result.code);
        connectStream(result.code);
        answerDraft = '';
        questionDraft = null;
        showToast('Room created! Invite your friends.');
      } else if (id === 'join-form') {
        const name = form.elements.name.value.trim();
        const code = form.elements.code.value.trim().toUpperCase();
        const result = await request('room:join', { code, name });
        saveName(name);
        saveSession(result.code, result.playerToken, result.hostKey);
        route(result.code);
        connectStream(result.code);
        showToast('You’re in!');
      } else if (id === 'answer-form') {
        const answer = form.elements.answer.value.trim();
        form.elements.answer.blur();
        await request('room:submit', { answer });
        showToast('Answer saved. Your secret is safe!');
      } else if (id === 'question-form') {
        const question = form.elements.question.value.trim();
        if (question === game.question) return showToast('That’s already the current question.');
        if (game.submittedCount > 0 && !confirm('Changing the question will clear everyone’s answers. Continue?')) return;
        await request('room:setQuestion', { question });
        showToast('Question updated!');
      } else if (id === 'next-form') {
        const question = form.elements.question.value.trim();
        await request('room:newRound', { question });
        showToast(`Round ${game.round} is live!`);
      }
    } catch (error) { showToast(error.message, true); }
    finally { if (button?.isConnected) button.disabled = false; }
  });

  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'copy') return copyLink();
    if (action === 'share') return shareLink();
    if (action === 'random-question') {
      questionDraft = randomQuestion();
      const input = document.querySelector('#question'); if (input) {input.value = questionDraft;input.focus();}
      return;
    }
    if (action === 'random-next') {
      nextDraft = randomQuestion();
      const input = document.querySelector('#next-question'); if (input) {input.value = nextDraft;input.focus();}
      return;
    }
    if (action === 'reveal') {
      if (game.submittedCount < game.players.length && !confirm(`${game.players.length - game.submittedCount} player(s) haven't answered yet. Reveal anyway?`)) return;
      return run('room:reveal', {});
    }
    if (action === 'reveal-one') return run('room:revealOne', { id: target.dataset.id });
    if (action === 'kick') {
      const name = game.players.find(p => p.id === target.dataset.id)?.name || 'this player';
      if (confirm(`Remove ${name} from the game?`)) return run('room:kick', { id: target.dataset.id });
    }
  });

  // Keep Render's free server awake during an active game. SSE handles live updates.
  setInterval(() => {
    if (game && sessionCode) request('room:ping').catch(() => {});
  }, 4 * 60 * 1000);

  if (sessionCode && safeStorageGet(sessionCode)) rejoinSaved(sessionCode);
  else renderHome();
})();