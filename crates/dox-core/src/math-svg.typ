// Keep the SVG rule out of paged contexts, including existing diagram frames.
#show math.equation: equation => context {
  if target() == "html" {
    let frame = html.frame({
      // Match the app's default foreground while retaining explicit math colors.
      set text(fill: rgb("#cdd6f4"))
      equation
    })
    if equation.block {
      html.elem("div", attrs: ("class": "dox-display-math"), frame)
    } else {
      box(frame)
    }
  } else {
    equation
  }
}
