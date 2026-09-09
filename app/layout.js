import "./globals.css";

export const metadata = {
  title: "HeyNow Registry",
  description: "Internal HeyNow event and source operations"
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
