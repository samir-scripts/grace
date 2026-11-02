<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
  let attemptId = $state<string | null>(null);
  let isHolding = $state(false);
  let holdProgress = $state(0); // 0.0 to 100.0
  let holdSecondsLeft = $state(60);
  let pulseTimer = $state<any>(null);
  let holdStartTime = $state<number | null>(null);

  // Passphrase state
  let passphraseFirst = $state('');
  let passphraseSecond = $state('');
  let passphraseError = $state<string | null>(null);
  let isSubmitting = $state(false);

  function resetHold() {
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
    if (isHolding) return;
    try {
      attemptId = await startEmergencyHold();
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
          if (finished) {
            clearInterval(pulseTimer);
            pulseTimer = null;
            isHolding = false;
            onClose();
          }
        } catch (err) {
          console.error('[escape] pulse error:', err);
          resetHold();
        }
      }, 250);
    } catch (err) {
      console.error('[escape] failed to start hold:', err);
      resetHold();
    }
  }

  function endHold() {
    if (isHolding) {
      resetHold();
    }
  }

  async function handlePassphraseSubmit(e: SubmitEvent) {
    e.preventDefault();
    passphraseError = null;

    if (passphraseFirst.length < 30) {
      passphraseError = 'Passphrase must be at least 30 characters long.';
      return;
    }
    if (passphraseFirst !== passphraseSecond) {
      passphraseError = 'Passphrases do not match. You must type it twice identically.';
      return;
    }

    isSubmitting = true;
    try {
      const ok = await submitEmergencyPassphrase(passphraseFirst);
      if (ok) {
        onClose();
      } else {
        passphraseError = 'Passphrase verification failed.';
      }
    } catch (err: any) {
      passphraseError = String(err);
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape' && !isHolding) {
      onClose();
    } else if (e.key === ' ' && mode === 'hold' && !isHolding) {
      e.preventDefault();
      beginHold();
    }
  }

  function handleKeyup(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === ' ' && mode === 'hold' && isHolding) {
      e.preventDefault();
      endHold();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', handleKeyup);
    window.addEventListener('blur', endHold);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('keyup', handleKeyup);
    window.removeEventListener('blur', endHold);
    resetHold();
  });
</script>

{#if open}
  <div class="escape-modal-backdrop" onclick={(e) => e.target === e.currentTarget && !isHolding && onClose()} role="presentation">
    <div class="escape-modal" role="dialog" aria-modal="true" aria-labelledby="escape-title">
      <div class="modal-header">
        <h2 id="escape-title" class="modal-title">⚠️ {m.session_emergency_exit()}</h2>
        {#if !isHolding}
          <button class="btn-close" onclick={onClose} aria-label="Close dialog">×</button>
        {/if}
      </div>

      <p class="modal-desc">
        Focus session is currently locked. To exit early, you must perform a deliberate action.
      </p>

      <div class="mode-tabs">
        <button
          class="mode-tab"
          class:active={mode === 'hold'}
          disabled={isHolding}
          onclick={() => { mode = 'hold'; resetHold(); }}
        >
          60-Second Hold
        </button>
        <button
          class="mode-tab"
          class:active={mode === 'passphrase'}
          disabled={isHolding}
          onclick={() => { mode = 'passphrase'; resetHold(); }}
        >
          Enter Passphrase
        </button>
      </div>

      {#if mode === 'hold'}
        <div class="hold-section">
          <p class="instruction">
            Press and hold the button below (or hold the <kbd>Spacebar</kbd>) continuously for <strong>60 seconds</strong>. Releasing early resets the timer.
          </p>

          <div class="hold-action-area">
            <button
              class="hold-btn"
              class:holding={isHolding}
              onmousedown={beginHold}
              onmouseup={endHold}
              onmouseleave={endHold}
              ontouchstart={beginHold}
              ontouchend={endHold}
              aria-label="Hold for 60 seconds to unlock"
            >
              <div class="hold-progress-fill" style="width: {holdProgress}%;"></div>
              <div class="hold-btn-text">
                {#if isHolding}
                  <span class="holding-countdown">{holdSecondsLeft}s remaining...</span>
                  <span class="subtext">Do not release!</span>
                {:else}
                  <span class="hold-prompt">Hold to Unlock</span>
                  <span class="subtext">Press and hold for 60s</span>
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
            Enter your 30+ character emergency passphrase twice to confirm early exit.
          </p>

          {#if passphraseError}
            <div class="alert error">{passphraseError}</div>
          {/if}

          <div class="input-group">
            <label for="pass-first">Passphrase</label>
            <input
              id="pass-first"
              type="password"
              class="text-input"
              bind:value={passphraseFirst}
              placeholder="Minimum 30 characters"
              required
            />
          </div>

          <div class="input-group">
            <label for="pass-second">Confirm Passphrase</label>
            <input
              id="pass-second"
              type="password"
              class="text-input"
              bind:value={passphraseSecond}
              placeholder="Re-enter passphrase"
              required
            />
          </div>

          <div class="form-actions">
            <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
            <button type="submit" class="btn-danger" disabled={isSubmitting}>
              {isSubmitting ? 'Verifying...' : 'Unlock Session'}
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
    font-size: 15px;
    font-weight: 700;
    color: var(--color-focus-round);
    margin: 0;
  }

  .btn-close {
    background: none;
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
    font-size: 11px;
    color: var(--color-foreground-darker);
    line-height: 1.4;
    margin: 0;
  }

  .mode-tabs {
    display: flex;
    gap: 6px;
    background: var(--color-background-light);
    padding: 3px;
    border-radius: 6px;
  }

  .mode-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 6px;
    font-size: 11px;
    font-weight: 500;
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
    font-size: 11px;
    color: var(--color-foreground-darker);
    line-height: 1.4;
    margin: 0 0 12px 0;
  }

  kbd {
    background: color-mix(in oklch, var(--color-foreground) 12%, transparent);
    border: 1px solid var(--color-separator);
    border-radius: 3px;
    padding: 1px 4px;
    font-family: inherit;
    font-size: 10px;
  }

  .hold-action-area {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
  }

  .hold-btn {
    position: relative;
    width: 100%;
    height: 72px;
    background: color-mix(in oklch, var(--color-focus-round) 15%, transparent);
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
    font-weight: 700;
    color: var(--color-foreground);
  }

  .holding-countdown {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-focus-round);
  }

  .subtext {
    font-size: 10px;
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
    background: color-mix(in oklch, var(--color-foreground) 16%, transparent);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-indicator {
    height: 100%;
    background: var(--color-focus-round);
    transition: width 0.2s linear;
  }

  .progress-label {
    font-size: 11px;
    font-weight: 600;
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
    font-size: 11px;
    color: var(--color-foreground-darker);
  }

  .text-input {
    background: var(--color-hover);
    border: 1px solid color-mix(in oklch, var(--color-foreground) 18%, transparent);
    border-radius: 6px;
    padding: 8px 10px;
    color: var(--color-foreground);
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .text-input:focus {
    border-color: var(--color-accent);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid var(--color-separator);
    color: var(--color-foreground);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-danger {
    background: var(--color-focus-round);
    border: none;
    color: var(--color-background);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alert.error {
    background: color-mix(in oklch, var(--color-focus-round) 15%, transparent);
    border: 1px solid var(--color-focus-round);
    color: var(--color-focus-round);
    padding: 8px;
    border-radius: 6px;
    font-size: 11px;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
