<script lang="ts">
  import ThemedSelect from '../../src/lib/components/ThemedSelect.svelte';
  let value = $state('a');
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Blocked', disabled: true }, { value: 'c', label: 'Charlie' }, { value: 'd', label: 'Delta' }];
</script>
<div style="height: 350px"></div>
<ThemedSelect id="choice" label="Choice" {value} {options} onchange={(next) => value = next} />
<output>{value}</output>
<ThemedSelect id="empty" label="Empty" value="" options={[]} onchange={() => {}} />
<ThemedSelect id="locked" label="Locked" value="a" {options} disabled onchange={() => {}} />
<button>Next</button>
