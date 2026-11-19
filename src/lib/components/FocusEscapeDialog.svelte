<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { modalFocus } from '$lib/utils/modalFocus';
  import {
    startEmergencyHold,
    pulseEmergencyHold,
    cancelEmergencyHold,
    submitEmergencyPassphrase,
  } from '$lib/ipc';
  import * as m from '$paraglide/messages.js';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  type Mode = 'hold' | 'passphrase';
  let mode = $state<Mode>('hold');

  // Hold state
  let pressActive = false;
  let holdGeneration = 0;
  let attemptId = $state<string | null>(null);
  let isHolding = $state(false);
  let holdProgress = $state(0); // 0.0 to 100.0
  let holdSecondsLeft = $state(60);
  let pulseTimer: ReturnType<typeof setInterval> | null = null;
  let holdStartTime = $state<number | null>(null);

  // Passphrase state
  let passphraseFirst = $state('');
  let passphraseSecond = $state('');
  let passphraseError = $state<string | null>(null);
  let isSubmitting = $state(false);
  let formGeneration = 0;

  function resetHold() {
    pressActive = false;
    holdGeneration++;
    if (attemptId) {
      cancelEmergencyHold(attemptId).catch(() => {});
    }
    if (pulseTimer) {
      clearInterval(pulseTimer);
      pulseTimer = null;
    }
    attemptId = null;
    isHolding = false;
    holdProgress = 0;
    holdSecondsLeft = 60;
    holdStartTime = null;
  }

  async function beginHold() {
    if (pressActive || isHolding) return;
    pressActive = true;
    const generation = ++holdGeneration;
    try {
      const id = await startEmergencyHold();
      if (!pressActive || generation !== holdGeneration || !open) {
        cancelEmergencyHold(id).catch(() => {});
        return;
      }
      attemptId = id;
      isHolding = true;
      holdStartTime = Date.now();
      holdSecondsLeft = 60;
      holdProgress = 0;

      pulseTimer = setInterval(async () => {
        if (!attemptId || !isHolding || !holdStartTime) return;
        const elapsedMs = Date.now() - holdStartTime;
        holdProgress = Math.min(100, (elapsedMs / 60000) * 100);
        holdSecondsLeft = Math.max(0, Math.ceil((60000 - elapsedMs) / 1000));

        try {
          const finished = await pulseEmergencyHold(attemptId);
          if (generation !== holdGeneration || !pressActive) return;
          if (finished) {
            if (pulseTimer) clearInterval(pulseTimer);
            pulseTimer = null;
            isHolding = false;
            onClose();
          }
        } catch (err) {
          console.error('[escape] pulse error:', err);
          if (generation === holdGeneration) resetHold();
        }
      }, 250);
    } catch (err) {
      console.error('[escape] failed to start hold:', err);
      if (generation === holdGeneration) resetHold();
    }
  }

  function endHold() {
    resetHold();
  }

  async function handlePassphraseSubmit(e: SubmitEvent) {
    e.preventDefault();
    passphraseError = null;

    if (passphraseFirst.length < 30) {
      passphraseError = m.escape_passphrase_short();
      return;
    }
    if (passphraseFirst !== passphraseSecond) {
      passphraseError = m.escape_passphrase_mismatch();
      return;
    }

    isSubmitting = true;
    const generation = formGeneration;
    try {
      const ok = await submitEmergencyPassphrase(passphraseFirst);
      if (generation !== formGeneration) return;
      if (ok) {
        onClose();
      } else {
        passphraseError = m.escape_passphrase_failed();
      }
    } catch {
      if (generation === formGeneration) passphraseError = m.escape_passphrase_failed();
    } finally {
      if (generation === formGeneration) isSubmitting = false;
    }
  }

  function closeDialog() {
    resetHold();
    onClose();
  }

  function holdKeydown(e: KeyboardEvent) {
    if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      beginHold();
    }
  }

  function holdKeyup(e: KeyboardEvent) {
    if (e.key === ' ') {
      e.preventDefault();
      endHold();
    }
  }

  $effect(() => {
    if (!open) {
      resetHold();
      mode = 'hold';
      passphraseFirst = '';
      passphraseSecond = '';
      passphraseError = null;
      isSubmitting = false;
      formGeneration++;
    }
  });

  onMount(() => window.addEventListener('blur', endHold));
  onDestroy(() => {
    window.removeEventListener('blur', endHold);
    resetHold();
  });
</script>

{#if open}
  <div class="escape-modal-backdrop" onclick={(e) => e.target === e.currentTarget && closeDialog()} role="presentation">
    <div class="escape-modal" role="dialog" aria-modal="true" aria-labelledby="escape-title" tabindex="-1" use:modalFocus={{ onEscape: closeDialog }}>
      <div class="modal-header">
        <h2 id="escape-title" class="modal-title">
          <svg
            class="warning-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2L1.5 13.5h13L8 2z" />
            <line x1="8" y1="6.5" x2="8" y2="9.5" />
            <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
          </svg>
          <span>{m.session_emergency_exit()}</span>
        </h2>
        <button class="btn-close" onclick={closeDialog} aria-label={m.escape_close()}>×</button>
      </div>

      <p class="modal-desc">
        {m.escape_description()}
      </p>

      <div class="mode-tabs">
        <button
          class="mode-tab"
          class:active={mode === 'hold'}
          disabled={isHolding}
          onclick={() => { mode = 'hold'; resetHold(); }}
        >
          {m.escape_hold_tab()}
        </button>
        <button
          class="mode-tab"
          class:active={mode === 'passphrase'}
          disabled={isHolding}
          onclick={() => { mode = 'passphrase'; resetHold(); }}
        >
          {m.escape_passphrase_tab()}
        </button>
      </div>

      {#if mode === 'hold'}
        <div class="hold-section">
          <p class="instruction">
            {m.escape_hold_instruction()}
          </p>

          <div class="hold-action-area">
            <button
              class="hold-btn"
              class:holding={isHolding}
              onpointerdown={(e) => { if (e.isPrimary && e.button === 0) beginHold(); }}
              onpointerup={endHold}
              onpointerleave={endHold}
              onpointercancel={endHold}
              onblur={endHold}
              onkeydown={holdKeydown}
              onkeyup={holdKeyup}
              aria-label={m.escape_hold_label()}
            >
              <div class="hold-progress-fill" style="width: {holdProgress}%;"></div>
              <div class="hold-btn-text">
                {#if isHolding}
                  <span class="holding-countdown">{m.escape_remaining({ seconds: String(holdSecondsLeft) })}</span>
                  <span class="subtext">{m.escape_do_not_release()}</span>
                {:else}
                  <span class="hold-prompt">{m.escape_hold_prompt()}</span>
                  <span class="subtext">{m.escape_hold_subtext()}</span>
                {/if}
              </div>
            </button>
          </div>

          <div class="progress-bar-container">
            <div class="progress-track">
              <div class="progress-indicator" style="width: {holdProgress}%;"></div>
            </div>
            <span class="progress-label">{Math.round(holdProgress)}%</span>
          </div>
        </div>
      {:else}
        <form class="passphrase-section" onsubmit={handlePassphraseSubmit}>
          <p class="instruction">
            {m.escape_passphrase_instruction()}
          </p>

          {#if passphraseError}
            <div class="alert error">{passphraseError}</div>
          {/if}

          <div class="input-group">
            <label for="pass-first">{m.escape_passphrase()}</label>
            <input
              id="pass-first"
              type="password"
              class="text-input"
              bind:value={passphraseFirst}
              placeholder={m.escape_passphrase_placeholder()}
              required
            />
          </div>

          <div class="input-group">
            <label for="pass-second">{m.escape_confirm_passphrase()}</label>
            <input
              id="pass-second"
              type="password"
              class="text-input"
              bind:value={passphraseSecond}
              placeholder={m.escape_confirm_placeholder()}
              required
            />
          </div>

          <div class="form-actions">
            <button type="button" class="btn-secondary" onclick={closeDialog}>{m.escape_cancel()}</button>
            <button type="submit" class="btn-danger" disabled={isSubmitting}>
              {isSubmitting ? m.escape_verifying() : m.escape_unlock()}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .escape-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    animation: fadeIn 0.15s ease both;
  }

  .escape-modal {
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    border-radius: 12px;
    width: 100%;
    max-width: 380px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    color: var(--color-foreground);
    user-select: none;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font: var(--type-heading);
    letter-spacing: 0;
    color: var(--color-foreground);
    margin: 0;
  }

  .btn-close {
    background: var(--color-background);
    border: none;
    color: var(--color-foreground-darker);
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .btn-close:hover {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .modal-desc {
    font: var(--type-body);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
    margin: 0;
  }

  .mode-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    background: var(--color-background-light);
    padding: 3px;
    border-radius: 6px;
  }

  .mode-tab {
    flex: 1;
    background: var(--color-background);
    border: none;
    border-radius: 4px;
    padding: 6px;
    font: var(--type-control);
    font-weight: 500;
    letter-spacing: 0;
    color: var(--color-foreground-darker);
    cursor: pointer;
    transition: background var(--transition-snappy), color var(--transition-snappy);
  }

  .mode-tab.active {
    background: var(--color-background);
    color: var(--color-foreground);
    font-weight: 600;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .instruction {
    font: var(--type-body);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
    margin: 0 0 12px 0;
  }


  .hold-action-area {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
  }

  .hold-btn {
    position: relative;
    width: 100%;
    min-height: 72px;
    background: var(--color-background-light);
    border: 2px solid var(--color-focus-round);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform var(--transition-snappy);
  }

  .hold-btn:active,
  .hold-btn.holding {
    transform: scale(0.98);
  }

  .hold-progress-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--color-focus-round);
    opacity: 0.35;
    transition: width 0.2s linear;
  }

  .hold-btn-text {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .hold-prompt {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-foreground);
  }

  .holding-countdown {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground);
  }

  .subtext {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
  }

  .progress-bar-container {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .progress-track {
    flex: 1;
    height: 6px;
    background: var(--color-background-light);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-indicator {
    height: 100%;
    background: var(--color-focus-round);
    transition: width 0.2s linear;
  }

  .progress-label {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
    min-width: 32px;
    text-align: right;
  }

  .passphrase-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-group label {
    font: var(--type-control);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
  }

  .text-input {
    background: var(--color-hover);
    border: 1px solid color-mix(in oklch, var(--color-foreground) 18%, transparent);
    border-radius: 6px;
    padding: 8px 10px;
    color: var(--color-foreground);
    font: var(--type-control);
    letter-spacing: 0;
    min-width: 0;
    outline: none;
  }

  .text-input:focus {
    border-color: var(--color-accent);
  }

  .form-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }

  .btn-secondary {
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    color: var(--color-foreground);
    border-radius: 6px;
    padding: 6px 14px;
    font: var(--type-control);
    letter-spacing: 0;
    cursor: pointer;
  }

  .btn-danger {
    background: var(--color-status-error);
    border: none;
    color: var(--color-background);
    border-radius: 6px;
    padding: 6px 14px;
    font: var(--type-control);
    font-weight: 500;
    letter-spacing: 0;
    cursor: pointer;
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alert.error {
    background: var(--color-background-light);
    border: 1px solid var(--color-focus-round);
    color: var(--color-foreground);
    padding: 8px;
    border-radius: 6px;
    font: var(--type-body);
    letter-spacing: 0;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
