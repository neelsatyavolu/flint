// Spike S3: Liquid Glass vs DESIGN.md. Throwaway.
import SwiftUI

@main struct SpikeApp: App {
    var body: some Scene { WindowGroup { Root() } }
}

private let ink = Color(red: 0.07, green: 0.07, blue: 0.065)
private let paper = Color(red: 0.97, green: 0.96, blue: 0.94)

struct Root: View {
    let variant = UserDefaults.standard.string(forKey: "variant") ?? "system"
    var body: some View {
        if variant == "flint" { FlintShell() } else { SystemShell() }
    }
}

struct Rows: View {
    var body: some View {
        ForEach(0..<30, id: \.self) { i in
            HStack {
                Circle().fill(i % 2 == 0 ? Color.blue : Color.orange).frame(width: 36, height: 36)
                VStack(alignment: .leading) {
                    Text("Sender \(i)").font(.headline)
                    Text("Subject line that runs behind the bars \(i)").font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct SystemShell: View {
    var body: some View {
        TabView {
            NavigationStack {
                List { Rows() }
                    .navigationTitle("Inbox")
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) { Button("Edit") {} }
                        ToolbarItem(placement: .bottomBar) { Button("Compose", systemImage: "square.and.pencil") {} }
                    }
            }
            .tabItem { Label("Mail", systemImage: "envelope") }
            Text("Search").tabItem { Label("Search", systemImage: "magnifyingglass") }
        }
    }
}

/// Opaque, flat bars drawn by us. No system navigation bar, tab bar or toolbar.
struct FlintBar: View {
    let title: String
    var body: some View {
        HStack {
            Text(title).font(.system(size: 17, weight: .semibold, design: .monospaced))
            Spacer()
            Text("Edit").font(.system(size: 15))
        }
        .padding(.horizontal, 16).frame(height: 48)
        .background(ink)
        .foregroundStyle(paper)
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.12)).frame(height: 1) }
    }
}

struct FlintShell: View {
    var body: some View {
        VStack(spacing: 0) {
            FlintBar(title: "Inbox")
            ScrollView { LazyVStack(alignment: .leading, spacing: 16) { Rows() }.padding(16) }
                .background(ink).foregroundStyle(paper)
            HStack { Text("Mail"); Spacer(); Text("Search") }
                .padding(.horizontal, 24).frame(height: 56)
                .background(ink).foregroundStyle(paper)
                .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.12)).frame(height: 1) }
        }
        .background(ink.ignoresSafeArea())
        .toolbarVisibility(.hidden, for: .navigationBar)
    }
}
