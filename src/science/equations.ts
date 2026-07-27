/**
 * Trusted, static KaTeX source for the Product Lenia law used by the scan.
 *
 * The local kernel uses the fractional part of 2ρ, matching
 * `shell % 1.0` in the scientific source. The two growth channels share σ,
 * while σ_r is reserved for the distinct far-ring width.
 */
export const DYNAMICS_EQUATIONS = [
  String.raw`\rho(\mathbf{x})=\frac{\lVert\mathbf{x}\rVert}{R_1},
    \qquad
    q(u)=
    \begin{cases}
      \exp\!\left[-16\left(u-\frac12\right)^2\right], & 0<u<1,\\
      0, & u\notin(0,1),
    \end{cases}`,

  String.raw`b_{\lfloor 2\rho\rfloor}=
    \begin{cases}
      \frac16, & 0\leq\rho<\frac12,\\
      1, & \frac12\leq\rho<1,
    \end{cases}
    \qquad
    \{z\}=z-\lfloor z\rfloor`,

  String.raw`K_1(\mathbf{x})=
    \kappa_1\,
    \mathbf{1}_{\{\rho(\mathbf{x})<1\}}\,
    b_{\lfloor 2\rho(\mathbf{x})\rfloor}\,
    q\!\left(\{2\rho(\mathbf{x})\}\right),
    \qquad
    \sum_{\mathbf{x}}K_1(\mathbf{x})=1`,

  String.raw`K_2(\mathbf{x})=
    \kappa_2
    \exp\!\left[
      -\frac{\left(\lVert\mathbf{x}\rVert-r_2\right)^2}{2\sigma_r^2}
    \right],
    \qquad
    \sum_{\mathbf{x}}K_2(\mathbf{x})=1`,

  String.raw`\begin{aligned}
    U_1(\mathbf{x})&=(K_1\mathbin{\ast_{\mathrm{per}}}A_t)(\mathbf{x}),&
    U_2(\mathbf{x})&=(K_2\mathbin{\ast_{\mathrm{per}}}A_t)(\mathbf{x}),\\
    C(\mathbf{x})&=s_c\,U_1(\mathbf{x})U_2(\mathbf{x}).
    \end{aligned}`,

  String.raw`G(U;m,\sigma)=
    2\exp\!\left[-\frac{(U-m)^2}{2\sigma^2}\right]-1,
    \qquad
    \nu(A)=\frac{A}{A+a_0}`,

  String.raw`\alpha=\frac{w_c}{w_c+w_\ell},
    \qquad
    1-\alpha=\frac{w_\ell}{w_c+w_\ell}`,

  String.raw`\begin{aligned}
    A_{t+1}(\mathbf{x})
    =\operatorname{clip}_{[0,1]}\!\Bigg[
      A_t(\mathbf{x})+\frac1T\Big(
        &(1-\alpha)\,
          G\!\left(U_1(\mathbf{x});m_\ell,\sigma\right)\\
        &+\alpha\,\nu\!\left(A_t(\mathbf{x})\right)
          G\!\left(C(\mathbf{x});m_c,\sigma\right)
      \Big)
    \Bigg].
    \end{aligned}`,

  String.raw`R_1=16.234777450561523,\qquad
    r_2=49.951690673828125,\qquad
    \sigma_r=18.25609588623047`,

  String.raw`s_c=7.31913948059082,\qquad
    \sigma=0.04,\qquad
    T=11.95116901397705`,

  String.raw`a_0=0.02188126929104328,\qquad \lambda=0`,
] as const;
