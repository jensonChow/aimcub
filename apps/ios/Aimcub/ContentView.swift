import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "scope")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Aimcub")
                .font(.largeTitle.weight(.semibold))
            Text("Aim management for the harness era")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
