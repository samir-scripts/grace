<script lang="ts">
  import { focusSnapshot } from '$lib/stores/focus';
  import { retryFocusEnforcement } from '$lib/ipc';

  let enf = $derived($focusSnapshot.enforcement);
  let isRetrying = $state(false);

  async function handleRetry() {
    if (isRetrying) return;
    isRetrying = true;
    try {
      await retryFocusEnforcement();
    } catch (e) {
      console.error('[enforcement notice] retry failed:', e);
    } finally {
      isRetrying = false;
    }
  }
</script>

{#if enf.state === 'failed' || enf.state === 'recovery_required'}
  <div class="notice-banner" class:danger={enf.state === 'recovery_required'}>
    <div class="notice-content">
      <span class="icon">⚠️</span>
      <span class="text">
        {#if enf.state === 'recovery_required'}
          Cleanup required for website blocking. Click Retry to restore access.
        {:else}
          Distraction blocking could not start. Ensure your browser extension is connected.
        {/if}
      </span>
    </div>
    <button class="retry-btn" onclick={handleRetry} disabled={isRetrying}>
      {isRetrying ? 'Retrying...' : 'Retry'}
    </button>
  </div>
{/if}

<style>
  .notice-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: rgba(243, 139, 168, 0.15);
    border: 1px solid rgba(243, 139, 168, 0.4);
    border-radius: 8px;
    padding: 8px 14px;
    margin: 8px 0;
    font-size: 13px;
    color: var(--color-foreground, #cdd6f4);
  }
  .notice-banner.danger {
    background: rgba(235, 77, 75, 0.2);
    border-color: rgba(235, 77, 75, 0.6);
  }
  .notice-content {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .icon {
    font-size: 14px;
  }
  .text {
    line-height: 1.4;
  }
  .retry-btn {
    background: var(--color-accent, #89b4fa);
    color: var(--color-background, #1e1e2e);
    border: none;
    border-radius: 4px;
    font-weight: 600;
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 120ms ease;
  }
  .retry-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .retry-btn:hover:not(:disabled) {
    opacity: 0.88;
  }
</style>
