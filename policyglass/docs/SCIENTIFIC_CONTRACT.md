# Scientific contract v1

## Numerical conventions

Reference execution: CPU float64, explicitly seeded RNGs, one torch CPU thread. Environment dynamics use SI and double precision. Gradients refer to minimized losses. Parameters are named; shapes, batch reduction and scalar loss coefficients are recorded. No batch-dependent normalization layers in the reference networks.

The implemented reference observation normalization uses fixed physical-unit means/scales, saved in checkpoints and differentiated in traces (see CONTRACTS.md). It has no mutable running statistics. Canonical MuJoCo WASM4.0.1, rather than a blocked native Windows wheel, performs the actual physics; see PHYSICS_RUNTIME.md.

The trace stores actual sample input, preactivation z, activation h, weight, bias, incoming/output gradients, loss terms, raw batch gradient, clipped gradient, pre/post optimizer states, and pre/post parameters. A sampled action's noise is stored. Tensor paths are stable and versioned.

For h=f(x W^T+b), dW=(dL/dz)^T x, db=sum(dL/dz), dx=(dL/dz) W. Per-sample gradients are of the exact selected minimized objective with batch coefficients; their sum reproduces the pre-clip aggregate gradient. Freeze normalization/targets/noise when making that comparison. Optimizer moment updates are not sample-additive.

## Policies

Bounded policy: u=mu+exp(logstd)*noise; normalized a=tanh(u); physical action=center+scale*a. Log probability includes both tanh Jacobian and constant action scale. Stable correction uses 2*(log(2)-u-softplus(-2*u)); avoid inconsistent epsilon derivatives. logstd bounds are explicit and stored.

PPO uses the same transformed distribution for sampling and action likelihood. The latent u is stored for stable reevaluation. Entropy regularization is documented as a fixed-noise Monte Carlo estimate of transformed entropy, not incorrectly called closed-form Gaussian entropy. SAC uses the same stable transformed policy.

## PPO

ratio_i=exp(logp_new_i-logp_old_i). Old probabilities and advantages are detached and fixed over rollout updates. Lpolicy=-mean(min(ratio*A,clip(ratio,1-eps,1+eps)*A)). Lvalue=0.5*mean((V-return)^2); Lentropy=mean(logp_resampled), weighted explicitly. Record which min/clip branch is selected; treat nondifferentiable boundaries separately.

delta_t=r_t+gamma*(not terminated_t)*V(next_observation_t)-V(observation_t). GAE_t=delta_t+gamma*lambda*(not episode_boundary_t)*GAE_next. A truncated episode bootstraps from its final observation but does not mix advantages across reset episodes. A collection boundary bootstraps without falsely marking terminal. Returns are Araw+Vold. Advantage standardization uses the fixed rollout mean/std, with explicit epsilon.

KL diagnostics include sampled logp_old-logp_new and the nonnegative estimator mean(exp(log_ratio)-1-log_ratio), clearly labeled approximate. Clipping does not impose a hard trust region. Default independent actor/value networks avoid an implicit shared update; any future shared variant has separately tested coefficients and paths.

## SAC

y=r+gamma*(not terminated)*(min(Qtarget1(s',a'),Qtarget2(s',a'))-alpha*logp(a'|s')). Target is detached, alpha detached in critic/actor losses. Critic losses 0.5*mean((Q-y)^2). Target sampling noise stored.

Lactor=mean(alpha*logp(a|s)-min(Q1(s,a),Q2(s,a))). During this update critic parameters are frozen; derivative through action remains. Actor has its own independent optimizer. Actor loss uses the critic version explicitly recorded after the critic update; the stage order is critic -> actor -> temperature -> target.

Let target_entropy be the desired differential entropy (default -action_dim). Lalpha=-mean(log_alpha*(logp_detached+target_entropy)); alpha=exp(log_alpha). This surrogate convention and the actual alpha are both displayed. Sampling units/action scaling are explicit; differential entropy depends on units. Target smoothing: target=(1-tau)*target+tau*online, 0<tau<=1, record pre/post.

Experience replay stores obs/action/reward/next_obs/terminated/truncated, pointer, capacity and valid size. Episode resets do not stop truncation bootstrap. Sampling is from the agent-owned RNG; all sampled indices are retained in trace.

## Optimizer and intervention

Adam: m=beta1*mold+(1-beta1)*g, v=beta2*vold+(1-beta2)*g^2, update=-lr*(m/(1-beta1^t))/(sqrt(v/(1-beta2^t))+eps). No weight decay in reference. Global gradient norm clipping is separately recorded before Adam. Pre/post states allow independent checking.

Intervention targets are whitelisted scalar hyperparameters and named parameter entries; no code expressions. Weight edits either preserve optimizer moments (explicitly labeled) or reset them; policy changes invalidate old trajectories for continued PPO collection. A single-step counterfactual may reuse a fixed stored batch only with its old-policy provenance visible.

## Checkpoint and physics

Snapshot all trainer/optimizer/normalization/RNG/rollout/replay/environment state. Use validated JSON and safetensors; never pickle. File count, sizes, hash, schema, paths, names, shapes and finite values checked before allocation/use. Atomic replacement stays inside configured D: artifact root.

The MuJoCo environment snapshot uses integration state plus model parameters and RNG. FK independently compares end-effector coordinates with the simulator. Physical model is idealized rigid body, not a real-robot safety assurance. Network animation coordinates are conceptual.

## Curves and slices

Q slice: freeze checkpoint, observation and all unplotted action coordinates. Grid coordinates are two selected physical action components; return both Qs and min. Loss slice: freeze checkpoint, batch, targets, all sampling noise and nonselected models; directions and units recorded. Display actual evaluated loss, not a fitted decorative surface. Numerical axes are never neuron layout coordinates.

## Evidence

Every report records actual command, runtime, seed, source revision, mode and limitations. Analytical/finite-difference tests are independent of implementation assertions. Smooth finite differences avoid clipping/ReLU/min ties; boundary behavior gets explicit branch tests. Record failed runs truthfully. Full training success and final UX remain distinct from numerical correctness.

