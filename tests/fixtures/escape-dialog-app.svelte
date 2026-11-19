<script lang="ts">
  import FocusEscapeDialog from '../../src/lib/components/FocusEscapeDialog.svelte';
  let open = $state(true);
</script>
<button id="opener" onclick={() => open = true}>Open</button>
<FocusEscapeDialog {open} onClose={() => open = false} />
