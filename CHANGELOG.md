# ![ThunderAI-Privacy icon](images/icon-32px.png "ThunderAI-Privacy") ThunderAI-Privacy Release Notes


<h2>Version 1.0.0 - ??/??/2026</h2>
<ul>
  <li>Local personal-data masking and response restoration for ThunderAI through processing API v1.</li>
  <li>WebGPU/CPU inference, chunked long inputs, isolated sessions, progress and cancellation.</li>
  <li>Settings in two steps: download the local model first, then turn on the protection. The switch is the same as the <i>Use ThunderAI Privacy</i> option of ThunderAI, and cannot be turned on before the model is ready.</li>
  <li>The model is downloaded in the background, so the download can also be started from ThunderAI (or by its administrator policy) and goes on after closing the settings. Access to Hugging Face is now requested at installation.</li>
  <li>The model cannot be deleted while the protection is on. Opt-in sensitive diagnostics.</li>
</ul>
